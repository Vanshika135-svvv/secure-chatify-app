const path = require("path");
const mongoose = require("mongoose");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const formatMessage = require("./utils/messages.js");
const { encrypt, decrypt } = require("./utils/cryptography.js");
const Cryptr = require("cryptr");
const Room = require("./RoomSchema.js");
const bcrypt = require("bcrypt");
var bodyParser = require("body-parser");
const cryptr = new Cryptr(
  "56dce7276d2b0a24e032beedf0473d743dbacf92aafe898e5a0f8d9898c9eae80a73798beed53489e8dbfd94191c1f28dc58cad12321d8150b93a2e092a744265fd214d7c2ef079e2f01b6d06319b7b2"
);

// --- FIXED DATABASE CONNECTION (Uses Environment Variable) ---
const MONGODB_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chat_db";

mongoose
  .connect(MONGODB_URI) 
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));
  
const {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
} = require("./utils/users.js"); 

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Setting static folder
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const botName = "Admin";

// Run when client connects (Socket.io Logic)
io.on("connection", (socket) => {
  socket.on("joinRoom", ({ username, room }) => {
    const user = userJoin(socket.id, username, room);

    socket.join(user.room);

    // Welcome current user
    socket.emit(
      "message",
      formatMessage(botName, cryptr.encrypt("Welcome To Chatbox"))
    );

    // When user enters a chat room
    socket.broadcast
      .to(user.room)
      .emit(
        "message",
        formatMessage(
          botName,
          cryptr.encrypt(`${user.username} has entered the chat room`)
        )
      );

    // Send room and users info
    io.to(user.room).emit("roomUsers", {
      room: user.room,
      users: getRoomUsers(user.room),
    });
  });

  socket.on("chatMessage", (msg) => {
    const user = getCurrentUser(socket.id);
    io.to(user.room).emit("message", formatMessage(user.username, msg));
  });

  // When user disconnects
  socket.on("disconnect", () => {
    const user = userLeave(socket.id);

    if (user) {
      io.to(user.room).emit(
        "message",
        formatMessage(
          botName,
          cryptr.encrypt(`${user.username} has left the chat`)
        )
      );

      // Send users and room info
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: getRoomUsers(user.room),
      });
    }
  });
});

// --- ROUTES ---

// ROUTE TO GET ALL ROOMS (For Dropdown Population)
app.get("/rooms", async (req, res) => {
    try {
        // Fetches only the 'name' field from all room documents
        const rooms = await Room.find({}, 'name').lean();
        const roomNames = rooms.map(room => room.name);
        res.json(roomNames); 
    } catch (error) {
        console.error("Error fetching rooms:", error);
        res.status(500).json([]);
    }
});


app.get("/decrypt", (req, res) => {
  const message = req.query.message;
  const decrypted = cryptr.decrypt(message);
  res.json(decrypted);
});

app.get("/encrypt", (req, res) => {
  const message = req.query.message;
  const encrypted = cryptr.encrypt(message);
  res.json(encrypted);
});

// ---------------------------------------------
// --- ROUTE 1: VALIDATE/JOIN EXISTING ROOM ---
// FIX: Switched to async/await and redirects all errors to one page.
// ---------------------------------------------
app.post("/validate", async (req, res) => {
  const { username, room: roomName, key } = req.body;
  
  const normalizedRoomName = roomName.toLowerCase().trim();

  try {
    const room = await Room.findOne({ name: normalizedRoomName });
    
    if (room === null) {
      // Room not found, redirect to the existing error page
      return res.redirect("/wrong-password.html"); 
    }

    if (await bcrypt.compare(key, room.secretKey)) {
      // SUCCESS: Redirect to chat.html
      const url = `/chat.html?room=${normalizedRoomName}&username=${username}&sk=${room._id}`;
      console.log("Redirecting to (JOIN SUCCESS): " + url);
      return res.redirect(url); 
    } else {
      // Wrong password, redirect to the existing error page
      return res.redirect("/wrong-password.html");
    }
  } catch (e) {
    console.error("Validation Error: ", e);
    // General error redirect to the existing error page
    return res.redirect("/wrong-password.html"); 
  }
});

// ---------------------------------------------
// --- ROUTE 2: CREATE NEW ROOM ---
// FIX: Redirects all creation errors to one page.
// ---------------------------------------------
app.post("/create", async (req, res) => {
  const { username, room: roomName, key } = req.body; 
  
  if (!username || !roomName || !key) {
    // Missing fields, redirect to the existing error page
    return res.redirect("/wrong-password.html"); 
  }
  
  const normalizedRoomName = roomName.toLowerCase().trim();
  
  try {
    const existingRoom = await Room.findOne({ name: normalizedRoomName });
    
    if (existingRoom) {
      // Room name already exists, redirect to the existing error page
      return res.redirect("/wrong-password.html"); 
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(key, saltRounds);

    const newRoom = new Room({
      name: normalizedRoomName,
      secretKey: hashedPassword,
    });
    
    await newRoom.save();
    console.log(`✅ New room created: ${normalizedRoomName}`);
    
    // SUCCESS: REDIRECTS TO CHAT PAGE
    const url = `/chat.html?room=${normalizedRoomName}&username=${username}&sk=${newRoom._id}`;
    return res.redirect(url);

  } catch (error) {
    console.error("Room Creation Error:", error);
    // General error redirect to the existing error page
    return res.redirect("/wrong-password.html");
  }
});


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));