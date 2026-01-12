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

    const io = new Server(httpServer);

    // Socket.io setup - track all users in each room
    const rooms = new Map(); // roomId -> Set of socket IDs

    io.on("connection", (socket) => {
        console.log("Client connected:", socket.id);

        socket.on("join-room", (roomId) => {
            socket.join(roomId);

            // Initialize room if it doesn't exist
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }

            const room = rooms.get(roomId);

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
            socket.to(data.to).emit("offer", { offer: data.offer, from: socket.id });
        });

        socket.on("answer", (data) => {
            socket.to(data.to).emit("answer", { answer: data.answer, from: socket.id });
        });

        socket.on("ice-candidate", (data) => {
            socket.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
        });

        socket.on("disconnect", () => {
            console.log("Client disconnected:", socket.id);

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
