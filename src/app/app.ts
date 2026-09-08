import express, { Application, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes";
import globalErrorHandler from "./middlewares/globalErrorHandler";
import routeNotFoundHandler from "./middlewares/routeNotFoundHandler";

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Browsers only. A native app sends no Origin header and is not subject to
// any of this, so adding an entry here cannot affect the mobile app.
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://72.244.153.29:3000",
      // Where people onboard and post their services while the app is waiting
      // on the App Store and Play Store. The apex joinwisper.com is a separate
      // WordPress site and does not call this API.
      "https://app.joinwisper.com",
      // The Vercel deployment the site is served from until the custom domain
      // is pointed at it. Kept afterwards so a deploy can be checked without
      // touching the live domain.
      "https://wisper-web-wispergroupcorporation-5621s-projects.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

app.use(cookieParser());

app.get("/", (_req: Request, res: Response) => {
  res.send({
    message: "Welcome to Wisper server 🛢️!",
  });
});

app.use("/api/v1", router);
app.use("/.well-known", express.static(".well-known"));

app.use(globalErrorHandler);
app.use(routeNotFoundHandler);

export default app;
