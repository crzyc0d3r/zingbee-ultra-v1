"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EvaluationRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/distillations/review?tab=dashboard");
  }, [router]);
  return <div style={{ padding: 32, textAlign: "center", opacity: 0.5 }}>Redirecting to Dashboard...</div>;
}
