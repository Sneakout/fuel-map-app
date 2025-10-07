// server.js (ESM)
import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true, methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "2mb" }));

const SYSTEM = `Return ONLY a bullet summary grouped as "This month" and "Cumulative". No chain-of-thought.`;
const stripThink = (t="") => t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

app.get("/api/health", (_req,res)=>res.json({ ok:true }));

app.post("/api/insights", async (req,res)=>{
  const payload = req.body || {};
  try {
    const r = await fetch("http://localhost:11434/api/chat", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        model:"deepseek-r1:14b",
        messages:[
          { role:"system", content: SYSTEM },
          { role:"user", content:`DATA:\n${JSON.stringify(payload)}\n\n<=10 bullets.` }
        ],
        stream:false,
        options:{ temperature:0.2, num_ctx:8192 }
      })
    });
    if (r.ok) {
      const data = await r.json();
      return res.json({ text: stripThink(data?.message?.content || "") || "(empty)" });
    }
  } catch (_) { /* fall through to mock */ }

  // mock fallback
  const ms = payload?.marketShare || {};
  const topG = ms.msMonthly?.[0]?.company || "—";
  const topL = ms.msMonthly?.[ms.msMonthly?.length-1]?.company || "—";
  const m = payload?.context?.latestMonth || "—";
  res.json({ text:
`This month (${m})
• Top MS gainer: ${topG}
• Top MS loser: ${topL}

Cumulative
• Companies tracked (MS): ${ms.msCum?.length ?? 0}
• Companies tracked (HSD): ${ms.hsdCum?.length ?? 0}` });
});

app.listen(3001, ()=>console.log("Insights API on :3001"));
