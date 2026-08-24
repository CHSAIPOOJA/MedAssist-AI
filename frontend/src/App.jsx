import { useState } from "react";

const API_URL = "http://localhost:8000";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [extractedText, setExtractedText] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function handleLogin(event) {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Enter a username and password to continue.");
      return;
    }
    setError("");
    setIsLoggedIn(true);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    setError("");
    setExtractedText("");

    if (file && file.type !== "application/pdf") {
      setSelectedFile(null);
      setError("Only PDF files are allowed.");
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Choose a PDF medical report first.");
      return;
    }

    setError("");
    setExtractedText("");
    setIsLoading(true);
    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Extraction failed.");
      setExtractedText(result.text || "No text was found in this PDF.");
    } catch (uploadError) {
      setError(uploadError.message || "Extraction failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <main className="page-shell login-shell">
        <section className="login-panel">
          <div className="brand-mark">+</div>
          <p className="eyebrow">PRIVATE HEALTH DOCUMENTS</p>
          <h1>Welcome to<br /><span>MedAssist AI</span></h1>
          <p className="muted">A clear first step toward understanding your medical reports.</p>
          <form onSubmit={handleLogin} className="form-stack">
            <label>Email or username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="you@example.com" /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
            {error && <p className="error-message">{error}</p>}
            <button className="primary-button" type="submit">Log in <span>→</span></button>
          </form>
          <p className="fine-print">Demo access · No account setup required</p>
        </section>
        <aside className="login-aside"><span>01</span><p>Upload.<br />Extract.<br /><strong>Understand.</strong></p></aside>
      </main>
    );
  }

  return (
    <main className="page-shell dashboard-shell">
      <header className="topbar"><div className="wordmark"><span className="brand-mark small">+</span> MedAssist AI</div><button className="logout-button" onClick={() => setIsLoggedIn(false)}>Log out</button></header>
      <section className="dashboard-content">
        <p className="eyebrow">DOCUMENT WORKSPACE</p>
        <h1>Make your report<br /><span>easier to read.</span></h1>
        <p className="intro">Upload your medical report to extract and understand the information.</p>
        <form onSubmit={handleUpload} className="upload-form">
          <label className="drop-zone">
            <input type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />
            <span className="upload-icon">↑</span>
            <strong>{selectedFile ? selectedFile.name : "Choose a medical report"}</strong>
            <span>{selectedFile ? "PDF ready to process" : "PDF files only · Max file size 20 MB"}</span>
          </label>
          {error && <p className="error-message">{error}</p>}
          <button className="primary-button extract-button" type="submit" disabled={isLoading}>{isLoading ? "Extracting report..." : "Upload & Extract →"}</button>
        </form>
        {extractedText && <section className="result-section"><div className="result-heading"><p className="eyebrow">TEXT EXTRACTION COMPLETE</p><h2>Extracted Medical Report</h2></div><pre>{extractedText}</pre></section>}
      </section>
    </main>
  );
}

export default App;
