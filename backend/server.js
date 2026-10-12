const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = require("./config/db");

const userRoutes = require("./routes/UserRoutes");
const eventRoutes = require("./routes/EventRoutes");
const bookingRoutes = require("./routes/BookingRoutes");
const adminRoutes = require("./routes/AdminRoutes");
const organizerRoutes = require("./routes/OrganizerRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/organizer", organizerRoutes);

app.get("/", (req, res) => {
  res.send("Event Management API is running");
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});