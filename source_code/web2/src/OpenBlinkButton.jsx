import React from "react";

const OpenBlinkButton = () => {
  // Check if we're on a mobile device.
  const isMobile = /android|iPad|iPhone|iPod/i.test(
    navigator.userAgent || navigator.vendor || window.opera
  );

  if (!isMobile) return null; // Only render on mobile

  const openBlinkApp = () => {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const appLink = "blink://"; // Custom URL scheme to open the Blink app.
    let fallbackLink = "";

    // Determine fallback link based on platform.
    if (/android/i.test(userAgent)) {
      fallbackLink =
        "https://play.google.com/store/apps/details?id=com.blink";
    } else if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      fallbackLink =
        "https://apps.apple.com/app/blink-home-security-camera/id1419012840";
    } else {
      fallbackLink = "https://blinkforhome.com";
    }

    // Set a timeout to open fallback in a new tab if the Blink app does not open.
    const timeout = setTimeout(() => {
      window.open(fallbackLink, "_blank");
    }, 1000);

    // Attempt to open the Blink app.
    window.location.href = appLink;

    // Clear the timeout if the page is hidden (i.e. the app opened).
    window.addEventListener("pagehide", () => clearTimeout(timeout));
  };

  return (
    <button className="btn btn-primary" onClick={openBlinkApp}>
      Open Blink App
    </button>
  );
};

export default OpenBlinkButton;
