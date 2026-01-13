/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const httpServer = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    const io = new Server(httpServer, {
        cors: {
            origin: process.env.ALLOWED_ORIGINS?.split(',') || [
                'http://localhost:3000',
                'http://127.0.0.1:3000',
                'https://p2p-file-production.up.railway.app'
            ],
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 1e8, // 100 MB max message size
        transports: ['websocket', 'polling']
    });

    // Security configuration
    const SECURITY_CONFIG = {
        maxConnectionsPerIP: 5,
        maxUsersPerRoom: 20,
        maxRooms: 1000,
        connectionTimeout: 30 * 60 * 1000, // 30 minutes
        maxRoomIdLength: 50
    };

    // Tracking structures
    const rooms = new Map(); // roomId -> Set of socket IDs
    const ipConnections = new Map(); // IP -> count
    const socketIPs = new Map(); // socketId -> IP
    const connectionTimes = new Map(); // socketId -> timestamp

    io.on("connection", (socket) => {
        // Get client IP
        const clientIP = socket.handshake.headers['x-forwarded-for']?.split(',')[0] ||
            socket.handshake.address;

        // Rate limiting: Check connections per IP
        const currentConnections = ipConnections.get(clientIP) || 0;
        if (currentConnections >= SECURITY_CONFIG.maxConnectionsPerIP) {
            console.log(`Rejected connection from ${clientIP}: too many connections (${currentConnections})`);
            socket.emit("error", { message: "Too many connections from your IP" });
            socket.disconnect();
            return;
        }

        // Track connection
        ipConnections.set(clientIP, currentConnections + 1);
        socketIPs.set(socket.id, clientIP);
        connectionTimes.set(socket.id, Date.now());

        console.log(`Client connected: ${socket.id} from ${clientIP}`);

        socket.on("join-room", (roomId) => {
            // Validate room ID
            if (!roomId || typeof roomId !== 'string') {
                socket.emit("error", { message: "Invalid room ID" });
                return;
            }

            if (roomId.length > SECURITY_CONFIG.maxRoomIdLength) {
                socket.emit("error", { message: "Room ID too long" });
                return;
            }

            // Check max rooms limit
            if (rooms.size >= SECURITY_CONFIG.maxRooms && !rooms.has(roomId)) {
                socket.emit("error", { message: "Server capacity reached" });
                return;
            }

            socket.join(roomId);

            // Initialize room if it doesn't exist
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }

            const room = rooms.get(roomId);

            // Check room size limit
            if (room.size >= SECURITY_CONFIG.maxUsersPerRoom) {
                socket.emit("error", { message: "Room is full" });
                socket.leave(roomId);
                return;
            }

            // Notify all existing users in the room about the new user
            room.forEach(existingUserId => {


                // Tell each existing user about the new user
                io.to(existingUserId).emit("user-connected", socket.id);
            });

            // Add the new user to the room
            room.add(socket.id);

            console.log(`Socket ${socket.id} joined room ${roomId}. Total users: ${room.size}`);
        });

        socket.on("offer", (data) => {
            if (data?.to && typeof data.to === 'string') {
                socket.to(data.to).emit("offer", { offer: data.offer, from: socket.id });
            }
        });

        socket.on("answer", (data) => {
            if (data?.to && typeof data.to === 'string') {
                socket.to(data.to).emit("answer", { answer: data.answer, from: socket.id });
            }
        });

        socket.on("ice-candidate", (data) => {
            if (data?.to && typeof data.to === 'string') {
                socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
            }
        });

        socket.on("disconnect", () => {
            console.log("Client disconnected:", socket.id);

            // Clean up IP tracking
            const ip = socketIPs.get(socket.id);
            if (ip) {
                const count = ipConnections.get(ip) || 1;
                if (count <= 1) {
                    ipConnections.delete(ip);
                } else {
                    ipConnections.set(ip, count - 1);
                }
                socketIPs.delete(socket.id);
            }

            // Clean up connection time tracking
            connectionTimes.delete(socket.id);

            // Remove user from all rooms
            rooms.forEach((userSet, roomId) => {
                if (userSet.has(socket.id)) {
                    userSet.delete(socket.id);

                    // Notify remaining users
                    userSet.forEach(userId => {
                        io.to(userId).emit("user-disconnected", socket.id);
                    });

                    // Clean up empty rooms
                    if (userSet.size === 0) {
                        rooms.delete(roomId);
                    }
                }
            });
        });
    });

    httpServer.once("error", (err) => {
        console.error(err);
        process.exit(1);
    });

    httpServer.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
        console.log(`> Network access on http://<YOUR_IP_ADDRESS>:${port}`);
    });
});
