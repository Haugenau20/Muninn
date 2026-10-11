import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './core/themes/ThemeContext';
import App from 'app/App';
import './styles/fonts.css';
import './styles/globals.css';
import { getApp } from 'firebase/app';
import { getFirebaseServices } from 'core/services/firebase';
import { useEmulators } from 'core/services/firebase/config/firebaseConfig';
import { attachAppCheck } from 'core/services/firebase/config/appCheck';

// Initialize AppCheck for enhanced security
// In development, we'll use debug tokens
if (process.env.NODE_ENV === 'development') {
  // Set debug token for Firebase App Check in development
  // @ts-ignore
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  
  // Use dynamic import to load the testing utilities
  import('./utils/__dev__/sessionTester')
    .then(() => console.log('Session testing utilities loaded'))
    .catch(err => console.error('Failed to load session testing utilities:', err));
}

// Initialize Firebase App Check to prevent abuse of our Cloud Functions
  // This requires a reCAPTCHA v3 site key from Google Console
  // https://console.cloud.google.com/security/recaptcha
  //
  // NOT initialized when running against the emulators (bug #1411). App Check
  // attests against the real Google backend even when every other Firebase
  // service is pointed at localhost, and the debug token the SDK generates for
  // development has to be registered by hand in the Firebase console for that
  // exchange to succeed. Unregistered, the exchange returns 403, and because
  // Auth attaches an App Check token to its requests, EVERY SIGN-IN FAILS with
  // `appCheck/fetch-status-error` before the credentials are ever checked.
  //
  // This was invisible until bug #1300 was fixed. Before that, getApp() threw
  // `app/no-app` here and the catch below swallowed it, so App Check never
  // actually initialized -- anywhere. Local sign-in worked by accident, and
  // making App Check work in production is what broke it.
  //
  // The emulators do not verify App Check tokens, so skipping it locally costs
  // no protection. Production behaviour is unchanged.
  if (!useEmulators) {
    try {
      // Initialize Firebase before reading the app back with getApp().
      //
      // This module does not import the Firebase barrel for its own sake, and it
      // must not rely on someone else's import doing the work: initialization used
      // to happen as a side effect of `import App from 'app/App'` (App transitively
      // imports the barrel, which called initializeFirebaseServices() at module
      // scope). Making that lazy so importing the barrel is side-effect free left
      // getApp() with no app to return, and App Check silently stopped initializing
      // because the catch below swallowed the resulting app/no-app error.
      getFirebaseServices();

      attachAppCheck(getApp());
      console.log('Firebase App Check initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Firebase App Check:', error);
    }
  } else {
    // Still needed: #1300's point was that nothing else initializes Firebase
    // eagerly any more, and the rest of the app calls getApp() expecting it.
    getFirebaseServices();
    console.log('Firebase App Check skipped (using emulators) - see bug #1411');
  }

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      {/*
        No NavigationProvider here: App mounts the one every consumer reads.
        Firebase Hosting rewrites every path to index.html, so a deep link
        reaches the router directly and unknown paths meet NotFoundPage.

        BrowserRouter runs every navigation as a React transition (React
        Router 7's default; `useTransitions={false}` would turn it off). The
        route pages load on first visit (T030); inside a transition React keeps
        the current page up until the next one's chunk has arrived, instead of
        swapping in the route fallback and back.
      */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);