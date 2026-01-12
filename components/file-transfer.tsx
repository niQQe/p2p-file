"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "@/lib/socket";
import type SimplePeer from "simple-peer"; // Type only import
// We use dynamic import for SimplePeer to avoid SSR issues and ensuring polyfills
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { FileUp, Download, Copy, Loader2 } from "lucide-react";

export function FileTransfer() {
    const [roomId, setRoomId] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isTransferring, setIsTransferring] = useState(false);
    const [transferProgress, setTransferProgress] = useState(0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [receivedFile, setReceivedFile] = useState<{ name: string; blob: Blob } | null>(null);
    const [incomingFile, setIncomingFile] = useState<{ name: string; size: number; chunks: Blob[]; totalChunks: number; startTime: number } | null>(null);
    const [transferStats, setTransferStats] = useState<{ speed: string; timeLeft: string } | null>(null);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(false);
    const [sentFiles, setSentFiles] = useState<{ name: string; size: number; duration: string; averageSpeed: string }[]>([]);
    const [receivedFilesHistory, setReceivedFilesHistory] = useState<{ name: string; size: number; duration: string; averageSpeed: string; blob: Blob }[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (_msg: string) => {
        // Logging disabled
    };

    const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());

    useEffect(() => {

        socket.connect();

        socket.on("connect", () => {

        });

        socket.on("user-connected", (userId) => {

            createPeer(userId, true);
        });

        socket.on("offer", (data) => {

            createPeer(data.from, false, data.offer);
        });

        socket.on("answer", (data) => {

            const peer = peersRef.current.get(data.from);
            if (peer) {
                peer.signal(data.answer);
            }
        });

        socket.on("ice-candidate", (data) => {
            const peer = peersRef.current.get(data.from);
            if (peer) {
                peer.signal(data.candidate);
            }
        });

        socket.on("user-disconnected", (userId) => {

            const peer = peersRef.current.get(userId);
            if (peer) {
                peer.destroy();
                peersRef.current.delete(userId);
                setConnectedPeers(prev => prev.filter(id => id !== userId));
                toast.info("A peer disconnected");
            }
        });


        // Polyfill for simple-peer in browser
        if (typeof window !== 'undefined') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(window as any).global) (window as any).global = window;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
            if (!(window as any).process) (window as any).process = require("process");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
            if (!(window as any).Buffer) (window as any).Buffer = require("buffer").Buffer;
        }

        return () => {
            socket.off("user-connected");
            socket.off("offer");
            socket.off("answer");
            socket.off("ice-candidate");
            socket.off("user-disconnected");
            socket.disconnect();
            peersRef.current.forEach(peer => peer.destroy());
            peersRef.current.clear();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function createPeer(userId: string, initiator: boolean, offer?: any) {


        // Don't create duplicate connections
        if (peersRef.current.has(userId)) {

            addLog(`Peer connection to ${userId} already exists`);
            return;
        }


        const SimplePeer = (await import("simple-peer")).default;
        const peer = new SimplePeer({
            initiator: initiator,
            trickle: false,
        });


        peer.on("connect", () => {
            setConnectedPeers(prev => [...new Set([...prev, userId])]);
            toast.success("Peer connected!");
        });

        peer.on("close", () => {

            peersRef.current.delete(userId);
            setConnectedPeers(prev => prev.filter(id => id !== userId));
            setIncomingFile(null);
            setReceivedFile(null);
            setTransferStats(null);
            toast.error("Peer disconnected");
        });

        peer.on("data", (data) => {
            try {
                const text = new TextDecoder().decode(data);
                if (text.startsWith('{"type":"metadata"')) {
                    const metadata = JSON.parse(text);

                    setIncomingFile({
                        name: metadata.name,
                        size: metadata.size,
                        totalChunks: metadata.totalChunks,
                        chunks: [],
                        startTime: Date.now()
                    });
                    setTransferStats({ speed: "0 KB/s", timeLeft: "Calculating..." });
                    toast.info(`Receiving ${metadata.name}...`);
                    return;
                }
            } catch {
                // Not text, likely binary chunk
            }

            setIncomingFile(prev => {
                if (!prev) return null;
                const newChunks = [...prev.chunks, new Blob([data])];

                // Calculate speed
                const elapsed = (Date.now() - prev.startTime) / 1000;
                if (elapsed > 0) {
                    const bytesReceived = newChunks.length * (prev.size / prev.totalChunks); // Approx
                    const speedBytes = bytesReceived / elapsed;
                    const speed = formatSpeed(speedBytes);
                    const remainingBytes = prev.size - bytesReceived;
                    const timeLeftSeconds = remainingBytes / speedBytes;
                    const timeLeft = formatTime(timeLeftSeconds);
                    setTransferStats({ speed, timeLeft });
                }

                if (newChunks.length === prev.totalChunks) {
                    const blob = new Blob(newChunks);
                    setTransferStats(null);
                    toast.success("File received complete!");

                    // Calculate final stats
                    const durationSeconds = (Date.now() - prev.startTime) / 1000;
                    const averageSpeedBytes = prev.size / durationSeconds;

                    setReceivedFilesHistory(history => {
                        const lastFile = history[history.length - 1];
                        if (lastFile && lastFile.name === prev.name && lastFile.size === prev.size) {
                            return history;
                        }

                        return [...history, {
                            name: prev.name,
                            size: prev.size,
                            duration: formatTime(durationSeconds),
                            averageSpeed: formatSpeed(averageSpeedBytes),
                            blob
                        }];
                    });

                    return null; // Reset incoming
                }
                return { ...prev, chunks: newChunks };
            });
        });

        peer.on("error", (err) => {
            console.error("Peer error", err);
            toast.error("Connection error");
        });

        peer.on("signal", (data) => {

            addLog(`Signal generated: ${data.type}`);
            if (data.type === 'offer') {

                socket.emit("offer", { offer: data, to: userId });
            } else if (data.type === 'answer') {

                socket.emit("answer", { answer: data, to: userId });
            } else if ('candidate' in data) {

                socket.emit("ice-candidate", { candidate: data, to: userId });
            }
        });

        // Handle incoming signal from offer (createPeer is called with offer data)
        if (!initiator && offer) {

            peer.signal(offer);
        }


        peersRef.current.set(userId, peer);
    }

    const joinRoom = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!roomId.trim()) return;
        addLog(`Joining room: ${roomId}`);
        socket.emit("join-room", roomId);
        setIsConnected(true);
        toast.success(`Joined room: ${roomId}`);
    };

    const createRoom = () => {
        const newRoomId = Math.random().toString(36).substring(7);
        setRoomId(newRoomId);
        socket.emit("join-room", newRoomId);
        setIsConnected(true);
        toast.success(`Created room: ${newRoomId}`);
    };

    const togglePause = () => {
        isPausedRef.current = !isPausedRef.current;
        setIsPaused(isPausedRef.current);
    };

    const sendFile = async () => {
        const peers = Array.from(peersRef.current.values());
        if (!file || peers.length === 0) return;
        setIsTransferring(true);
        const startTime = Date.now();

        // 256KB chunk size for efficient WebRTC throughput
        const chunkSize = 256 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);

        // Send metadata to all peers
        const metadata = JSON.stringify({
            type: "metadata",
            name: file.name,
            size: file.size,
            totalChunks
        });

        peers.forEach(peer => {
            try {
                peer.send(metadata);
            } catch (err) {
                console.error("Error sending metadata:", err);
            }
        });

        const arrayBuffer = await file.arrayBuffer();

        // Hysteresis Backpressure configuration
        const HIGH_WATER_MARK = 1024 * 1024; // 1MB
        const LOW_WATER_MARK = 256 * 1024;   // 256KB

        for (let i = 0; i < totalChunks; i++) {
            // Pause Logic
            while (isPausedRef.current) {
                await new Promise(r => setTimeout(r, 200));
            }

            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = arrayBuffer.slice(start, end);

            // Send chunk to all peers
            for (const peer of peers) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const peerAny = peer as any;

                // Backpressure check per peer
                if (peerAny._channel && peerAny._channel.bufferedAmount > HIGH_WATER_MARK) {
                    while (peerAny._channel.bufferedAmount > LOW_WATER_MARK) {
                        await new Promise(r => setTimeout(r, 1));
                    }
                }

                try {
                    peer.send(chunk);
                } catch (err) {
                    console.error("Send error to peer", err);
                    await new Promise(r => setTimeout(r, 5));
                }
            }

            // Update stats sparingly - every 40 chunks (~10MB) or last chunk
            if (i % 40 === 0 || i === totalChunks - 1) {
                const elapsed = (Date.now() - startTime) / 1000;
                if (elapsed > 0) {
                    const bytesSent = (i + 1) * chunkSize;
                    const speedBytes = bytesSent / elapsed;
                    const speed = formatSpeed(speedBytes);
                    const remainingBytes = file.size - bytesSent;
                    const timeLeft = (speedBytes > 0 && isFinite(remainingBytes / speedBytes))
                        ? formatTime(remainingBytes / speedBytes)
                        : "Calculating...";
                    setTransferStats({ speed: speed + " (Upload)", timeLeft });
                }
                setTransferProgress(Math.round(((i + 1) / totalChunks) * 100));

                // Yield very briefly to keep UI responsive
                await new Promise(r => setTimeout(r, 0));
            }
        }

        setIsTransferring(false);
        setTransferStats(null);

        // Calculate final stats
        const durationSeconds = (Date.now() - startTime) / 1000;
        const averageSpeedBytes = file.size / durationSeconds;

        setSentFiles(prev => [...prev, {
            name: file.name,
            size: file.size,
            duration: formatTime(durationSeconds),
            averageSpeed: formatSpeed(averageSpeedBytes)
        }]);

        toast.success(`File sent to ${peers.length} peer(s)!`);
    };

    return (
        <div className="max-w-md mx-auto space-y-8">
            {/* App Header */}
            <div className="text-center space-y-2 pt-8">
                <div className="flex items-center justify-center gap-3">
                    <img src="/logo.svg" alt="Vibe Share" className="w-12 h-12" />
                    <h1 className="text-5xl font-black tracking-tight bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent drop-shadow-sm">
                        Vibe Share
                    </h1>
                </div>
                <p className="text-sm text-muted-foreground font-medium">
                    Instant file transfer between unlimited users
                </p>
            </div>

            {!isConnected ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Start Transfer</CardTitle>
                        <CardDescription>Create a room or join one to transfer files.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button onClick={createRoom} className="w-full">Create New Room</Button>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">Or join with ID</span>
                            </div>
                        </div>
                        <div className="flex space-x-2">
                            <form onSubmit={joinRoom} className="flex w-full space-x-2">
                                <Input placeholder="Room ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
                                <Button type="submit" variant="secondary">Join</Button>
                            </form>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Room: {roomId}</CardTitle>
                        <CardDescription>
                            {connectedPeers.length > 0 ? `Connected to ${connectedPeers.length} peer(s)` : "Waiting for peers..."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {connectedPeers.length === 0 && (
                            <div className="flex items-center justify-center py-8">
                                <div className="flex flex-col items-center space-y-2 text-muted-foreground">
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                    <p>Share Room ID: <span className="font-mono font-bold text-foreground select-all">{roomId}</span></p>
                                    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(roomId); toast.success("Copied!"); }}>
                                        <Copy className="h-4 w-4 mr-2" /> Copy ID
                                    </Button>
                                </div>
                            </div>
                        )}

                        {connectedPeers.length > 0 && (
                            <>
                                <div className="space-y-4">
                                    <Label>Send File</Label>
                                    <div
                                        className={`relative border-2 border-dashed rounded-lg p-6 transition-colors ${file ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                                            }`}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const droppedFile = e.dataTransfer.files[0];
                                            if (droppedFile) {
                                                setFile(droppedFile);
                                            }
                                        }}
                                    >
                                        <input
                                            type="file"
                                            id="file-input"
                                            className="sr-only"
                                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                                        />
                                        <label
                                            htmlFor="file-input"
                                            className="flex flex-col items-center justify-center cursor-pointer"
                                        >
                                            {file ? (
                                                <>
                                                    <FileUp className="h-8 w-8 mb-2 text-primary" />
                                                    <p className="text-sm font-medium text-foreground mb-1">{file.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {(file.size / 1024 / 1024).toFixed(2)} MB • Click to change
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <FileUp className="h-8 w-8 mb-2 text-muted-foreground" />
                                                    <p className="text-sm font-medium text-foreground mb-1">
                                                        Choose a file or drag and drop
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">Any file type supported</p>
                                                </>
                                            )}
                                        </label>
                                    </div>
                                    <div className="flex space-x-2">
                                        <Button onClick={sendFile} disabled={!file || isTransferring} className="flex-1">
                                            {isTransferring ? "Sending..." : "Send File"} <FileUp className="ml-2 h-4 w-4" />
                                        </Button>

                                        {isTransferring && (
                                            <Button onClick={togglePause} variant="secondary" className="shrink-0">
                                                {isPaused ? <Loader2 className="h-4 w-4 animate-spin" /> : <Loader2 className="h-4 w-4" />}
                                                {isPaused ? "Resume" : "Pause"}
                                            </Button>
                                        )}
                                    </div>

                                    {isTransferring && transferStats && (
                                        <div className="space-y-3 p-4 border rounded-lg bg-card shadow-sm">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="font-medium truncate max-w-[200px]">{file?.name}</span>
                                                <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                                                    {transferProgress}%
                                                </span>
                                            </div>
                                            <Progress value={transferProgress} className="h-2" />

                                            <div className="grid grid-cols-2 gap-4 text-xs mt-3 pt-3 border-t">
                                                <div className="flex flex-col">
                                                    <span className="text-muted-foreground">Speed</span>
                                                    <span className="font-mono font-medium">{transferStats.speed}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-muted-foreground">Time Left</span>
                                                    <span className="font-mono font-medium">{transferStats.timeLeft}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Incoming File (Active Transfer) */}
                                    {incomingFile && (
                                        <div className="space-y-3 p-4 border rounded-lg bg-card shadow-sm">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="font-medium truncate max-w-[200px]">{incomingFile.name}</span>
                                                <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                                                    {Math.round((incomingFile.chunks.length / incomingFile.totalChunks) * 100)}%
                                                </span>
                                            </div>
                                            <Progress value={(incomingFile.chunks.length / incomingFile.totalChunks) * 100} className="h-2" />

                                            <div className="grid grid-cols-2 gap-4 text-xs mt-3 pt-3 border-t">
                                                <div className="flex flex-col">
                                                    <span className="text-muted-foreground">Speed</span>
                                                    <span className="font-mono font-medium">{transferStats?.speed || '-'}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-muted-foreground">Time Left</span>
                                                    <span className="font-mono font-medium">{transferStats?.timeLeft || '-'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Sent Files History */}
                                    {sentFiles.length > 0 && (
                                        <div className="space-y-3 pt-4 border-t">
                                            <Label>Sent Files</Label>
                                            {sentFiles.map((f, i) => (
                                                <div key={i} className="p-3 border rounded-lg bg-card shadow-sm text-xs flex flex-col space-y-2">
                                                    <div className="font-medium truncate max-w-[200px]">{f.name}</div>
                                                    <div className="grid grid-cols-2 gap-2 text-muted-foreground border-t pt-2">
                                                        <div>Time: <span className="text-foreground">{f.duration}</span></div>
                                                        <div>Avg Speed: <span className="text-foreground">{f.averageSpeed}</span></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Received Files History (merged with download) */}
                                {receivedFilesHistory.length > 0 && (
                                    <div className="space-y-3 pt-4 border-t">
                                        <Label>Received Files & History</Label>
                                        {receivedFilesHistory.map((f, i) => (
                                            <div key={i} className="p-3 border rounded-lg bg-card shadow-sm text-xs flex flex-col space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <div className="font-medium truncate max-w-[200px]">{f.name}</div>
                                                    <Button size="sm" className="h-7 text-xs" onClick={() => {
                                                        const url = URL.createObjectURL(f.blob);
                                                        const a = document.createElement('a');
                                                        a.href = url;
                                                        a.download = f.name;
                                                        a.click();
                                                    }}>
                                                        <Download className="h-3 w-3 mr-1" /> Download
                                                    </Button>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-muted-foreground border-t pt-2">
                                                    <div>Time: <span className="text-foreground">{f.duration}</span></div>
                                                    <div>Avg Speed: <span className="text-foreground">{f.averageSpeed}</span></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function formatSpeed(bytesPerSec: number) {
    if (bytesPerSec === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatTime(seconds: number) {
    if (!isFinite(seconds) || seconds < 0) return "Calculating...";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m ${Math.ceil(seconds % 60)}s`;
}
