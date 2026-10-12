const express = require("express");

const router = express.Router();

const {
  registerUser,
  loginUser,
  getUsers,
  getUserNotifications,
} = require("../controllers/UserController");
const { authMiddleware, authorizeRoles } = require("../Middleware/authMiddleware");

router.post("/register", registerUser);

router.post("/login", loginUser);

router.get("/notifications", authMiddleware, getUserNotifications);

router.get("/", authMiddleware, authorizeRoles("admin", "organizer"), getUsers);

module.exports = router;