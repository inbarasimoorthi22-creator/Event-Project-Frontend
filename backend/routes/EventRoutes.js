const express = require("express");
const router = express.Router();

const {
  createEvent,
  getEventCategories,
  getEvents,
  getOrganizerEvents,
  getEventById,
  submitEventForApproval,
  updateEvent,
  deleteEvent,
} = require("../controllers/eventController");
const { authMiddleware, optionalAuthMiddleware, authorizeRoles } = require("../Middleware/authMiddleware");

router.post("/", authMiddleware, authorizeRoles("organizer", "admin"), createEvent);

router.get("/", getEvents);

router.get("/categories", getEventCategories);

router.get(
  "/organizer/mine",
  authMiddleware,
  authorizeRoles("organizer"),
  getOrganizerEvents
);

router.patch("/:id/submit", authMiddleware, authorizeRoles("organizer"), submitEventForApproval);

router.get("/:id", optionalAuthMiddleware, getEventById);

router.put("/:id", authMiddleware, authorizeRoles("organizer", "admin"), updateEvent);

router.delete("/:id", authMiddleware, authorizeRoles("organizer", "admin"), deleteEvent);

module.exports = router;