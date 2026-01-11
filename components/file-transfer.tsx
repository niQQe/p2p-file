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
import { FileUp, Download, Link as LinkIcon, Copy, Loader2 } from "lucide-react";

export function FileTransfer() {
    const [roomId, setRoomId] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isTransferring, setIsTransferring] = useState(false);
    const [transferProgress, setTransferProgress] = useState(0);
    const [receivedFile, setReceivedFile] = useState<{ name: string; blob: Blob } | null>(null);
    const [incomingFile, setIncomingFile] = useState<{ name: string; size: number; chunks: Blob[]; totalChunks: number; startTime: number } | null>(null);
    const [transferStats, setTransferStats] = useState<{ speed: string; timeLeft: string } | null>(null);
    const [peerConnected, setPeerConnected] = useState(false);
    const [isInitiator, setIsInitiator] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        console.log(msg);
    };

    const peerRef = useRef<SimplePeer.Instance | null>(null);

    useEffect(() => {
        socket.connect();

        socket.on("connect", () => {
            console.log("Connected to server", socket.id);
        });

        socket.on("user-connected", (userId) => {
            console.log("User connected:", userId);
            // We are the initiator (already in room), so we create the offer
            setIsInitiator(true);
            createPeer(userId, true);
        });

        socket.on("offer", (data) => {
            console.log("Received offer from:", data.from);
            createPeer(data.from, false, data.offer);
        });

        socket.on("answer", (data) => {
            console.log("Received answer");
            if (peerRef.current) {
                peerRef.current.signal(data.answer);
            }
        });

        socket.on("ice-candidate", (data) => {
            if (peerRef.current) {
                peerRef.current.signal(data.candidate);
            }
        });

        // Polyfill for simple-peer in browser
        if (typeof window !== 'undefined') {
            if (!(window as any).global) (window as any).global = window;
            if (!(window as any).process) (window as any).process = require("process");
            if (!(window as any).Buffer) (window as any).Buffer = require("buffer").Buffer;
        }

        return () => {
            socket.off("user-connected");
            socket.off("offer");
            socket.off("answer");
            socket.off("ice-candidate");
            socket.disconnect();
            if (peerRef.current) peerRef.current.destroy();
        };
    }, []);

    async function createPeer(userId: string, initiator: boolean, offer?: any) {
        if (peerRef.current) {
            addLog("Peer already exists, destroying old one");
            peerRef.current.destroy();
        }

        const SimplePeer = (await import("simple-peer")).default;
        const peer = new SimplePeer({
            initiator: initiator,
            trickle: false, // Simple setup, disable trickle for simplicity if needed, but simple-peer handles it. simpler to start with false usually for one-shot offer/answer but better true for connectivity. Let's try default (true) or just be explicit.
            // Actually simple-peer docs say trickle defaults to true.
        });



        // Correction: simple-peer separates 'signal' event which gives you a payload to send to other peer.
        // The payload *is* the offer/answer/candidate.
        // So I can check `data.type`.

        peer.on("connect", () => {
            console.log("Peer connected!");
            setPeerConnected(true);
            toast.success("Peer connected!");
        });

        peer.on("close", () => {
            console.log("Peer connection closed");
            setPeerConnected(false);
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
                    console.log("Received metadata:", metadata);
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
                    setReceivedFile({ name: prev.name, blob });
                    setTransferStats(null);
                    toast.success("File received complete!");
                    return null; // Reset incoming
                }
                return { ...prev, chunks: newChunks };
            });
        });

        peer.on("error", (err) => {
            console.error("Peer error", err);
            toast.error("Connection error");
        });

        // We overwrite the signal logic above slightly to match server
        // We overwrite the signal logic above slightly to match server
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

        peerRef.current = peer;
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

    const sendFile = async () => {
        if (!file || !peerRef.current) return;
        setIsTransferring(true);
        const startTime = Date.now();

        // 256KB chunk size for efficient WebRTC throughput
        const chunkSize = 256 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);

        // Send metadata
        const metadata = JSON.stringify({
            type: "metadata",
            name: file.name,
            size: file.size,
            totalChunks
        });
        peerRef.current.send(metadata);

        const arrayBuffer = await file.arrayBuffer();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peer = peerRef.current as any; // Cast to access _channel

        // Hysteresis Backpressure configuration
        // We fill buffer up to 1MB, then wait until it drains to 256KB
        const HIGH_WATER_MARK = 1024 * 1024; // 1MB
        const LOW_WATER_MARK = 256 * 1024;   // 256KB

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = arrayBuffer.slice(start, end);

            // Backpressure: If buffer is full, wait for it to drain significantly
            if (peer._channel && peer._channel.bufferedAmount > HIGH_WATER_MARK) {
                while (peer._channel.bufferedAmount > LOW_WATER_MARK) {
                    await new Promise(r => setTimeout(r, 1)); // Minimal wait loop
                }
            }

            try {
                peer.send(chunk);
            } catch (err) {
                console.error("Send error", err);
                // If send fails, brief pause
                await new Promise(r => setTimeout(r, 5));
            }

            // Update stats sparingly - every 40 chunks (~10MB) or last chunk
            if (i % 40 === 0 || i === totalChunks - 1) {
                const elapsed = (Date.now() - startTime) / 1000;
                if (elapsed > 0) {
                    const bytesSent = (i + 1) * chunkSize;
                    const speed = formatSpeed(bytesSent / elapsed);
                    setTransferStats({ speed: speed + " (Upload)", timeLeft: "" });
                }
                setTransferProgress(Math.round(((i + 1) / totalChunks) * 100));

                // Yield very briefly to keep UI responsive
                await new Promise(r => setTimeout(r, 0));
            }
        }

        setIsTransferring(false);
        setTransferStats(null);
        toast.success("File sent!");
    };

    return (
        <div className="max-w-md mx-auto space-y-8">
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
                            {peerConnected ? "Connected to peer" : "Waiting for peer..."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {!peerConnected && (
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

                        {peerConnected && (
                            <>
                                <div className="space-y-4">
                                    <Label>Send File</Label>
                                    <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                                    <Button onClick={sendFile} disabled={!file || isTransferring} className="w-full">
                                        {isTransferring ? "Sending..." : "Send File"} <FileUp className="ml-2 h-4 w-4" />
                                    </Button>

                                    {isTransferring && transferStats && (
                                        <div className="grid grid-cols-2 gap-4 text-xs p-3 bg-muted/50 rounded-lg">
                                            <div className="flex flex-col">
                                                <span className="text-muted-foreground">Speed</span>
                                                <span className="font-mono font-medium">{transferStats.speed}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-muted-foreground">Progress</span>
                                                <span className="font-mono font-medium">{transferProgress}%</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

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
                                                <span className="text-muted-foreground">Time Remaining</span>
                                                <span className="font-mono font-medium">{transferStats?.timeLeft || '-'}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {receivedFile && (
                                    <div className="p-4 border rounded-lg bg-secondary/50 flex items-center justify-between">
                                        <span className="font-medium truncate max-w-[200px]">{receivedFile.name}</span>
                                        <Button size="sm" variant="outline" onClick={() => {
                                            const url = URL.createObjectURL(receivedFile.blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = receivedFile.name; // Use actual filename
                                            a.click();
                                        }}>
                                            <Download className="h-4 w-4" />
                                        </Button>
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
