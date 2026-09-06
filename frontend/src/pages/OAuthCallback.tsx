import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { auth as tokens } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

export default function OAuthCallback() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");

    if (!access || !refresh) {
      navigate("/login?oauth_error=Sign-in did not complete", { replace: true });
      return;
    }

    tokens.set(access, refresh);
    refreshUser().then(() => navigate("/dashboard", { replace: true }));
  }, [navigate, refreshUser]);

  return <Spinner label="Finishing sign-in" />;
}
