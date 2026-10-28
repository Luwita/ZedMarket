import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';

// Where Google sends people back to. Clerk finishes the sign-in here, then the person moves on to the page they
// came from.
export default function SsoCallback() {
  const { finishGoogleSignIn } = useStore();
  const [error, setError] = useState(null);
  const started = useRef(false); // Clerk's one-time sign-in link works only once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A full page load, so the app picks up the new session.
    finishGoogleSignIn((path) => window.location.replace(path || '/login')).catch((err) => setError(err.message));
  }, [finishGoogleSignIn]);

  return (
    <div className="container section narrow">
      <div className="card form-card auth center">
        {error ? (
          <>
            <p className="error">{error}</p>
            <Link to="/login" className="btn btn-primary">
              Back to sign in
            </Link>
          </>
        ) : (
          <p className="muted">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
