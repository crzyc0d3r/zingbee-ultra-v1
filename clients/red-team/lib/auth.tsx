"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { onAuthExpired } from "./auth-bus";

interface StudentInfo {
  student_id: string;
  name: string;
}

interface UserInfo {
  student_id: string;
  students: StudentInfo[];
  display_name: string;
  email: string;
}

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  switchStudent: (studentId: string) => Promise<void>;
  createStudent: (name: string) => Promise<StudentInfo>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  switchStudent: async () => {},
  createStudent: async () => ({ student_id: "", name: "" }),
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Listen for 401s from apiFetch. Force a full-page navigation to "/" so
  // the entire UI tears down and re-mounts at the home route, which shows
  // the LoginOverlay when unauthenticated. A simple setUser(null) is not
  // enough because individual pages may render child components that swallow
  // 401s into local error states, leaving stale UI fragments visible.
  //
  // The `redirecting` guard debounces concurrent 401s — a dashboard with N
  // parallel fetches all returning 401 should redirect once, not N times.
  // Track whether the user was ever authenticated this session. A 401 when
  // wasAuthenticated is false means "not logged in yet" — just clear state,
  // don't reload. A 401 when true means "session expired" — redirect/reload
  // to tear down stale UI.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (user) wasAuthenticated.current = true;
  }, [user]);

  useEffect(() => {
    let redirecting = false;
    const handler = () => {
      if (redirecting) return;
      redirecting = true;
      setUser(null);
      if (typeof window === "undefined") return;

      // If the user was never authenticated, don't reload — just clear
      // state and let the login overlay render naturally.
      if (!wasAuthenticated.current) return;

      // Stash where the user was so we can return them after re-login.
      try {
        const here = window.location.pathname + window.location.search + window.location.hash;
        if (here && here !== "/") {
          sessionStorage.setItem("redirectAfterLogin", here);
        }
      } catch {}
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      } else {
        window.location.reload();
      }
    };
    return onAuthExpired(handler);
  }, []);

  // After a successful login, return the user to wherever they were when
  // their session expired, then clear the stash.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    try {
      const target = sessionStorage.getItem("redirectAfterLogin");
      if (target && target !== window.location.pathname + window.location.search + window.location.hash) {
        sessionStorage.removeItem("redirectAfterLogin");
        window.location.href = target;
      } else if (target) {
        sessionStorage.removeItem("redirectAfterLogin");
      }
    } catch {}
  }, [user]);

  const login = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, turnstile_token: turnstileToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Login failed");
    }
    const data = await res.json();
    setUser({
      student_id: data.student_id,
      students: data.students,
      display_name: data.display_name,
      email: email,
    });
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const res = await fetch("/api/google-login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Google login failed");
    }
    const data = await res.json();
    setUser({
      student_id: data.student_id,
      students: data.students,
      display_name: data.display_name,
      email: data.email,
    });
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  }, []);

  const switchStudent = useCallback(
    async (studentId: string) => {
      const res = await fetch("/api/switch-student", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId }),
      });
      if (!res.ok) throw new Error("Failed to switch student");
      setUser((prev) => (prev ? { ...prev, student_id: studentId } : null));
    },
    [],
  );

  const createStudent = useCallback(async (name: string): Promise<StudentInfo> => {
    const res = await fetch("/api/create-student", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create student");
    }
    const data = await res.json();
    const newStudent: StudentInfo = data.student;
    setUser((prev) =>
      prev
        ? {
            ...prev,
            student_id: newStudent.student_id,
            students: [...prev.students, newStudent],
          }
        : null
    );
    return newStudent;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout, switchStudent, createStudent }}>
      {children}
    </AuthContext.Provider>
  );
}
