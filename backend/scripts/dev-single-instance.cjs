"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = process.cwd();
const lockFile = path.join(root, ".dev-backend.lock");

function isRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function readLockPid() {
  try {
    const raw = fs.readFileSync(lockFile, "utf8");
    const data = JSON.parse(raw);
    return typeof data.pid === "number" ? data.pid : null;
  } catch {
    return null;
  }
}

function tryAcquireLock() {
  if (fs.existsSync(lockFile)) {
    const oldPid = readLockPid();
    if (oldPid !== null && isRunning(oldPid)) {
      console.error(`[start:dev] Another dev server is already running (PID ${oldPid}).`);
      console.error(`[start:dev] Stop it first, or delete a stale lock: ${lockFile}`);
      process.exit(1);
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(
    lockFile,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    "utf8",
  );
}

function releaseLock() {
  try {
    if (!fs.existsSync(lockFile)) {
      return;
    }
    const raw = fs.readFileSync(lockFile, "utf8");
    const data = JSON.parse(raw);
    if (data.pid === process.pid) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    /* ignore */
  }
}

tryAcquireLock();

const nestCliJs = path.join(root, "node_modules", "@nestjs", "cli", "bin", "nest.js");
if (!fs.existsSync(nestCliJs)) {
  console.error("[start:dev] Missing Nest CLI at", nestCliJs);
  releaseLock();
  process.exit(1);
}

const child = spawn(process.execPath, [nestCliJs, "start", "--watch"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  releaseLock();
  if (signal) {
    process.exit(code === null ? 1 : code);
  }
  process.exit(code === null ? 0 : code);
});

child.on("error", (err) => {
  console.error(err);
  releaseLock();
  process.exit(1);
});

["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      releaseLock();
      process.exit(1);
    }
  });
});
