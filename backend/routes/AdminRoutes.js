const express = require("express");
const router = express.Router();
const { authMiddleware, authorizeRoles } = require("../Middleware/authMiddleware");
const {
  changeAdminPassword,
  getAdminProfile,
  getActivityLogs,
  getCategories,
  getDashboard,
  getNotifications,
  getOrganizers,
  getOrganizerDetails,
  getReports,
  getSettings,
  getVenues,
  getVenueAvailability,
  saveCategory,
  saveVenue,
  sendNotification,
  updateAdminProfile,
  updateOrganizerStatus,
  updateSettings,
  deleteCategory,
  deleteVenue,
} = require("../controllers/AdminController");
const {
  createEvent,
  deleteEvent,
  getAdminEvents,
  updateEvent,
  updateEventStatus,
} = require("../controllers/EventController");
const {
  deleteAdminUser: deleteUser,
  getAdminUserDetails: getUserDetails,
  getAdminUsers: getUsers,
  getUserBookingHistory: getUserBookings,
  setAdminUserStatus,
  updateAdminUser: updateUser,
} = require("../controllers/UserController");
const { deleteBooking, getBookings, updateBookingStatus } = require("../controllers/BookingController");

router.use(authMiddleware, authorizeRoles("admin"));

router.get("/dashboard", getDashboard);
router.get("/reports", getReports);

router.get("/users", getUsers);
router.get("/users/:id/bookings", getUserBookings);
router.get("/users/:id", getUserDetails);
router.put("/users/:id", updateUser);
router.patch("/users/:id/status", setAdminUserStatus);
router.delete("/users/:id", deleteUser);

router.get("/organizers", getOrganizers);
router.get("/organizers/:id", getOrganizerDetails);
router.patch("/organizers/:id", updateOrganizerStatus);

router.get("/events", getAdminEvents);
router.post("/events", createEvent);
router.put("/events/:id", updateEvent);
router.patch("/events/:id/status", updateEventStatus);
router.delete("/events/:id", deleteEvent);

router.get("/bookings", getBookings);
router.patch("/bookings/:id/status", updateBookingStatus);
router.delete("/bookings/:id", deleteBooking);

router.get("/venues", getVenues);
router.get("/venues/availability", getVenueAvailability);
router.post("/venues", saveVenue);
router.put("/venues/:id", saveVenue);
router.delete("/venues/:id", deleteVenue);

router.get("/categories", getCategories);
router.post("/categories", saveCategory);
router.put("/categories/:id", saveCategory);
router.delete("/categories/:id", deleteCategory);

router.get("/notifications", getNotifications);
router.post("/notifications", sendNotification);
router.get("/activity", getActivityLogs);

router.get("/settings", getSettings);
router.put("/settings", updateSettings);

router.get("/profile", getAdminProfile);
router.put("/profile", updateAdminProfile);
router.put("/profile/password", changeAdminPassword);

module.exports = router;