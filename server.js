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

    io.on("connection", (socket) => {
        console.log("Client connected:", socket.id);

        socket.on("join-room", (roomId) => {
            socket.join(roomId);
            console.log(`Socket ${socket.id} joined room ${roomId}`);
            // Notify others in room
            socket.to(roomId).emit("user-connected", socket.id);
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
