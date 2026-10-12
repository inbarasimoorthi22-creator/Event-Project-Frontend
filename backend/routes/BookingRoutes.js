const express = require("express");
const router = express.Router();

const {
  createBooking,
  getBookings,
  getBookingById,
  deleteBooking,
} = require("../controllers/BookingController");
const { authMiddleware } = require("../Middleware/authMiddleware");

router.use(authMiddleware);

router.post("/", createBooking);

router.get("/", getBookings);

router.get("/:id", getBookingById);

router.delete("/:id", deleteBooking);

module.exports = router;