import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import IOLiveGen from "./IOLiveGen.jsx";

const PASSWORD = "M1chael0505";
const SESSION_KEY = "io_live_auth";

function PasswordGate({ children }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (authed) return children;

  function handleSubmit(e) {
    e.preventDefault();
    if (input === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setAuthed(true);
    } else {
      setError(true);
      setInput("");
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "#2D1060", fontFamily: "Arial, sans-serif"
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "#fff", borderRadius: 12, padding: "2.5rem 2rem",
        width: 320, boxShadow: "0 4px 32px rgba(0,0,0,0.3)", textAlign: "center"
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#2D1060" }}>
          Infinite Opportunity™
        </div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
          Live Intelligence — Enter password to continue
        </div>
        <input
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          placeholder="Password"
          autoFocus
          style={{
            width: "100%", padding: "10px 12px", fontSize: 15,
            border: error ? "1.5px solid #e53e3e" : "1.5px solid #ccc",
            borderRadius: 6, boxSizing: "border-box", marginBottom: 8, outline: "none"
          }}
        />
        {error && <div style={{ color: "#e53e3e", fontSize: 13, marginBottom: 8 }}>Incorrect password</div>}
        <button type="submit" style={{
          width: "100%", padding: "10px", background: "#4A2480", color: "#fff",
          border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4
        }}>
          Enter
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PasswordGate>
      <IOLiveGen />
    </PasswordGate>
  </StrictMode>
);
