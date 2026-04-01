import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.js")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

async function runClaudeTurn({ projectPath, model, prompt, permissionMode = "default" }, emit) {
  const args = ["-y", "@gitlawb/openclaude", "-p", prompt, "--print", "--output-format", "stream-json", "--permission-mode", permissionMode, "--model", model, "--add-dir", projectPath];
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: projectPath, env: process.env });
    let buffer = "";
    let output = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        emit(line);
        output += `${line}\n`;
      }
    });
    child.stderr.on("data", (chunk) => emit(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(`openclaude exit ${code}`))));
  });
}

async function runDebate(payload, emit) {
  const { task, projectPath, roleModelMap, validationCommands } = payload;
  const messages = [];
  const phases = ["proposal", "critique", "revision"];
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    for (const role of ["architect", "critic", "implementer"]) {
      const model = roleModelMap[role];
      const context = messages.map((m) => `[${m.role}/${m.phase}] ${m.content}`).join("\n");
      const prompt = `You are ${role}. Phase ${phase}. Task: ${task}. Context: ${context}. ${role === "implementer" ? "Apply concrete code changes in the repository when needed." : "Provide precise analysis."}`;
      const content = await runClaudeTurn({ projectPath, model, prompt, permissionMode: role === "implementer" ? "acceptEdits" : "default" }, emit);
      messages.push({ role, phase, round: i + 1, model, content });
    }
  }

  const finalPlan = await runClaudeTurn({
    projectPath,
    model: roleModelMap.judge,
    prompt: `Judge these debate outputs and synthesize best final plan:\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")}`
  }, emit);
  messages.push({ role: "judge", phase: "verdict", round: 4, model: roleModelMap.judge, content: finalPlan });

  let validationReport = await runClaudeTurn({
    projectPath,
    model: roleModelMap.verifier,
    permissionMode: "acceptEdits",
    prompt: `Run and summarize these validation commands for task ${task}:\n${validationCommands.join("\n")}`
  }, emit);
  messages.push({ role: "verifier", phase: "validation", round: 5, model: roleModelMap.verifier, content: validationReport });

  if (/(failed|error|exception)/i.test(validationReport)) {
    emit("Validation failed; running repair round");
    const repair = await runClaudeTurn({
      projectPath,
      model: roleModelMap.implementer,
      permissionMode: "acceptEdits",
      prompt: `Fix the repository based on this validation report and rerun minimal checks:\n${validationReport}`
    }, emit);
    messages.push({ role: "implementer", phase: "repair", round: 6, model: roleModelMap.implementer, content: repair });
    validationReport = await runClaudeTurn({
      projectPath,
      model: roleModelMap.verifier,
      permissionMode: "acceptEdits",
      prompt: `Re-run validations and summarize:\n${validationCommands.join("\n")}`
    }, emit);
    messages.push({ role: "verifier", phase: "validation", round: 7, model: roleModelMap.verifier, content: validationReport });
  }

  const { stdout: diff } = await execFileAsync("git", ["-C", projectPath, "diff", "--", "."], { maxBuffer: 10 * 1024 * 1024 });
  return { messages, finalPlan, validationReport, diff: diff || "No diff generated." };
}

app.whenReady().then(() => {
  ipcMain.handle("project:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("debate:run", async (_evt, payload) => {
    const logs = [];
    const emit = (line) => logs.push(line);
    const result = await runDebate(payload, emit);
    return { ...result, logs };
  });

  createWindow();
});
