"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Script from "next/script";
import { useAuth } from "@/lib/auth";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function LoginOverlay() {
  const { user, loading, login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || user) return;
    const render = () => {
      const ts = (window as any).turnstile;
      if (!ts || !turnstileRef.current || turnstileWidgetId.current) return;
      turnstileWidgetId.current = ts.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };
    if ((window as any).turnstile) render();
    else (window as any).__turnstileOnLoad = render;
  }, [user]);

  const handleGoogleCallback = useCallback(async (response: any) => {
    setError("");
    setSubmitting(true);
    try {
      await loginWithGoogle(response.credential);
    } catch (err: any) {
      setError(err.message || "Google login failed");
    } finally {
      setSubmitting(false);
    }
  }, [loginWithGoogle]);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !googleBtnRef.current || user) return;
    const initGoogle = () => {
      (window as any).google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
        use_fedcm_for_prompt: false,
      });
      (window as any).google?.accounts.id.renderButton(googleBtnRef.current!, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        width: 280,
      });
    };
    if ((window as any).google?.accounts) initGoogle();
    else (window as any).__googleLoginInit = initGoogle;
  }, [user, handleGoogleCallback]);

  if (loading) {
    return (
      <div className="login-overlay">
        <div className="login-card">
          <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the human verification.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await login(email, password, turnstileToken || undefined);
    } catch (err: any) {
      setError(err.message || "Login failed");
      const ts = (window as any).turnstile;
      if (ts && turnstileWidgetId.current) {
        ts.reset(turnstileWidgetId.current);
        setTurnstileToken("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-overlay" id="loginOverlay">
      <div className="login-card">
        <img
          src="/static/robot-bee.png"
          alt="ZingBee"
          width={100}
          height={100}
          style={{ display: "block", margin: "0 auto 16px" }}
        />
        <h2>ZingBee RT Studio</h2>
        <div className="login-subtitle">Sign in to continue</div>
        <div className="login-error" id="loginError">{error}</div>
        <form id="loginForm" onSubmit={handleSubmit}>
          <label htmlFor="loginEmail">Email or Username</label>
          <input
            type="text"
            id="loginEmail"
            placeholder="Email or username"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <label htmlFor="loginPassword">Password</label>
          <input
            type="password"
            id="loginPassword"
            placeholder="Password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {TURNSTILE_SITE_KEY && (
            <div ref={turnstileRef} style={{ display: "flex", justifyContent: "center", margin: "12px 0" }} />
          )}
          <button
            type="submit"
            className="login-btn"
            id="loginBtn"
            disabled={submitting || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
        {TURNSTILE_SITE_KEY && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad"
            strategy="afterInteractive"
          />
        )}
        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
          <>
            <div style={{ textAlign: "center", margin: "16px 0 12px", color: "#64748b", fontSize: 13 }}>or</div>
            <div style={{ position: "relative", width: "100%", height: 40 }}>
              <div ref={googleBtnRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0.01, zIndex: 2 }} />
              <button
                type="button"
                className="login-btn"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 1, margin: 0 }}
                disabled={submitting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff"/>
                </svg>
                Sign in with Google
              </button>
            </div>
            <Script
              src="https://accounts.google.com/gsi/client"
              strategy="afterInteractive"
              onLoad={() => (window as any).__googleLoginInit?.()}
            />
          </>
        )}
      </div>
    </div>
  );
}
