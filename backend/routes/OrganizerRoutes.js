const express = require("express");
const router = express.Router();
const { authMiddleware, authorizeRoles } = require("../Middleware/authMiddleware");
const {
  changeOrganizerPassword,
  getOrganizerAttendees,
  getOrganizerBookings,
  getOrganizerDashboard,
  getOrganizerProfile,
  getOrganizerSettings,
  getOrganizerUserDetails,
  getOrganizerUsers,
  getOrganizerVenueAvailability,
  getOrganizerVenues,
  updateAttendanceStatus,
  updateOrganizerBookingStatus,
  updateOrganizerProfile,
  updateOrganizerSettings,
} = require("../controllers/OrganizerController");

router.use(authMiddleware, authorizeRoles("organizer"));

router.get("/dashboard", getOrganizerDashboard);
router.get("/analytics", getOrganizerDashboard);
router.get("/bookings", getOrganizerBookings);
router.patch("/bookings/:bookingId/status", updateOrganizerBookingStatus);
router.get("/attendees", getOrganizerAttendees);
router.patch("/attendees/:bookingId/status", updateAttendanceStatus);
router.get("/users", getOrganizerUsers);
router.get("/users/:userId", getOrganizerUserDetails);
router.get("/venues/availability", getOrganizerVenueAvailability);
router.get("/venues", getOrganizerVenues);
router.get("/profile", getOrganizerProfile);
router.put("/profile", updateOrganizerProfile);
router.put("/profile/password", changeOrganizerPassword);
router.get("/settings", getOrganizerSettings);
router.put("/settings", updateOrganizerSettings);

module.exports = router;