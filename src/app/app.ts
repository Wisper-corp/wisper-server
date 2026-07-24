import express, { Application, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes";
import globalErrorHandler from "./middlewares/globalErrorHandler";
import routeNotFoundHandler from "./middlewares/routeNotFoundHandler";

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: ["http://localhost:3000", "http://72.244.153.29:3000"],
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

// Group invite link — opens app if installed, else redirects to Play Store
app.get("/groups/:groupId", (req: Request, res: Response) => {
  const { groupId } = req.params;
  const playStoreUrl = "https://play.google.com/store/apps/details?id=com.wisperuser.app";
  const appStoreUrl = "https://apps.apple.com/app/wisper/id123456789"; // update with real ID when published
  const deepLink = `https://wisperonline.com/groups/${groupId}`;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join Group on Wisper</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d0d0d; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .logo { width: 80px; height: 80px; border-radius: 20px; background: #1877F2; display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #8E8E93; margin-bottom: 30px; }
    .btn { display: block; width: 100%; max-width: 300px; padding: 16px; border-radius: 50px; font-size: 16px; font-weight: 600; text-decoration: none; margin-bottom: 12px; }
    .btn-primary { background: #1877F2; color: white; }
    .btn-secondary { background: #2A2A2A; color: white; }
  </style>
</head>
<body>
  <div class="logo">W</div>
  <h1>You're invited to join a group on Wisper</h1>
  <p>Open the Wisper app to join this group</p>
  <a class="btn btn-primary" href="${deepLink}" id="openApp">Open in Wisper</a>
  <a class="btn btn-secondary" href="${playStoreUrl}" id="playStore">Download Wisper</a>
  <script>
    // Try to open the app, fallback to store after 2 seconds
    window.location.href = "${deepLink}";
    setTimeout(function() {
      var ua = navigator.userAgent.toLowerCase();
      if (/iphone|ipad|ipod/.test(ua)) {
        window.location.href = "${appStoreUrl}";
      } else {
        window.location.href = "${playStoreUrl}";
      }
    }, 2500);
  </script>
</body>
</html>`);
});

app.use(globalErrorHandler);
app.use(routeNotFoundHandler);

export default app;
