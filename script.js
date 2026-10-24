/*
  FILE OVERVIEW
  This file is the behavior and time-calculation layer for the landscape.
  It reads local device time, converts it into minutes after midnight, derives
  the current visual values, and writes those values to the DOM and CSS
  custom properties. style.css remains responsible for drawing and transitions.

  UPDATE PIPELINE
  getCurrentTime() -> getMinutesOfDay() -> updateClock() and the scene update
  functions -> CSS custom properties / page text -> CSS renders the new scene.
  updateScene() runs once immediately, every second in live mode, and when a
  previously hidden browser tab becomes visible again.

  TIME MODEL
  TIME stores the visual boundaries as minutes after midnight. Values between
  boundaries are interpolated so most changes are gradual rather than discrete.
  The visitor's local device clock is the source of truth; there is no server.
*/

// TIME CONFIGURATION
// All boundaries use minutes after midnight so comparisons and interpolation
// can use ordinary numeric ranges instead of parsing formatted clock strings.

const TIME = {
  sunrise: 6 * 60, // 06:00
  morning: 9 * 60, // 09:00
  noon: 12 * 60, // 12:00
  goldenStart: 17 * 60, // 17:00
  sunset: 18 * 60 + 30, // 18:30
  dusk: 20 * 60, // 20:00
  night: 21 * 60, // 21:00
};

// Set TEST_MODE to true to preview a fixed time without changing the device clock.
const TEST_MODE = false;

// These values are used only when TEST_MODE is enabled.
const TEST_HOUR = 17;
const TEST_MINUTE = 30;

// DOM REFERENCES
// Cache elements once rather than querying the document on every one-second update.
const root = document.documentElement;

const timeElement = document.getElementById("time");

const greetingElement = document.getElementById("greeting");

const descriptionElement = document.getElementById("scene-description");

const timelineProgress = document.getElementById("timeline-progress");

const liveStatus = document.getElementById("live-status");

const phaseElements = document.querySelectorAll(".time-phase");

// NUMERIC AND COLOR HELPERS
// These helpers normalize progress values and make the animation calculations reusable.

function clamp(value, min = 0, max = 1) {
  // Keep opacity/progress values within their expected range.
  return Math.min(Math.max(value, min), max);
}

/*
   Convert a value from one range to another.

   Example:

   mapRange(50, 0, 100, 0, 1)
   -> 0.5
*/

function mapRange(value, inputMin, inputMax, outputMin, outputMax) {
  // Convert the value's relative position in the input range to the output range.
  const progress = (value - inputMin) / (inputMax - inputMin);

  return outputMin + progress * (outputMax - outputMin);
}

function smoothStep(value) {
  // Ease the normalized value so interpolation changes more gently at either end.
  const t = clamp(value);

  return t * t * (3 - 2 * t);
}

function lerp(start, end, progress) {
  // Return a point between start and end; progress 0 gives start, 1 gives end.
  return start + (end - start) * progress;
}

/*
   Convert RGB values into a CSS rgb() string.
*/
function rgb(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/*
   Smoothly interpolate between two RGB colors.
*/
function interpolateColor(colorA, colorB, progress) {
  // Ease the progress, interpolate each RGB channel, and format it for CSS.
  const t = smoothStep(progress);

  return rgb(
    lerp(colorA[0], colorB[0], t),
    lerp(colorA[1], colorB[1], t),
    lerp(colorA[2], colorB[2], t),
  );
}

// CLOCK AND TIME CONVERSION
function getCurrentTime() {
  if (TEST_MODE) {
    // A predictable fixed value makes visual states easy to inspect during development.
    return {
      hours: TEST_HOUR,
      minutes: TEST_MINUTE,
      seconds: 0,
    };
  }
  const now = new Date();

  // Date's local getters use the visitor's configured local time and timezone.
  return {
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  };
}

//    CONVERT TIME TO MINUTES
function getMinutesOfDay(time) {
  // Seconds become a fraction of a minute for smoother position/color calculations.
  return time.hours * 60 + time.minutes + time.seconds / 60;
}

// Return both a visitor-friendly 12-hour string and a seconds-inclusive variant.
function formatTime(time) {
  const hours24 = time.hours;

  const hours12 = hours24 % 12 || 12;

  const minutes = String(time.minutes).padStart(2, "0");

  const seconds = String(time.seconds).padStart(2, "0");

  const period = hours24 >= 12 ? "PM" : "AM";

  return {
    short: `${hours12}:${minutes} ${period}`,

    long: `${hours12}:${minutes}:${seconds} ${period}`,
  };
}

function updateClock(time) {
  const formatted = formatTime(time);

  // textContent writes plain text; dateTime exposes a machine-readable 24-hour value.
  timeElement.textContent = formatted.short;

  timeElement.dateTime =
    `T${String(time.hours).padStart(2, "0")}:` +
    `${String(time.minutes).padStart(2, "0")}:` +
    `${String(time.seconds).padStart(2, "0")}`;
}

// SKY COLOR KEYFRAMES
// Each stop defines top/middle/bottom RGB colors at a particular minute of day.
// updateSky() interpolates between the neighboring stops.

const SKY_STOPS = [
  {
    time: 0,
    top: [8, 20, 55],
    middle: [22, 39, 76],
    bottom: [34, 56, 78],
  },

  {
    time: TIME.sunrise,
    top: [65, 126, 176],
    middle: [156, 194, 207],
    bottom: [239, 177, 118],
  },

  {
    time: TIME.morning,
    top: [67, 171, 225],
    middle: [143, 213, 239],
    bottom: [239, 222, 181],
  },

  {
    time: TIME.noon,
    top: [61, 177, 232],
    middle: [151, 219, 242],
    bottom: [244, 226, 184],
  },

  {
    time: TIME.goldenStart,
    top: [82, 151, 205],
    middle: [236, 174, 124],
    bottom: [249, 133, 79],
  },

  {
    time: TIME.sunset,
    top: [62, 91, 157],
    middle: [213, 119, 116],
    bottom: [247, 116, 67],
  },

  {
    time: TIME.dusk,
    top: [30, 49, 91],
    middle: [57, 66, 103],
    bottom: [88, 67, 91],
  },

  {
    time: TIME.night,
    top: [7, 17, 48],
    middle: [15, 29, 65],
    bottom: [23, 43, 67],
  },
];

/*
   Get the two sky stops surrounding the current time.
*/
function getSkyStops(minutes) {
  // Start with the midnight-to-sunrise interval; the loop selects the actual pair.
  let previous = SKY_STOPS[SKY_STOPS.length - 1];

  let next = SKY_STOPS[0];

  for (let i = 0; i < SKY_STOPS.length; i++) {
    if (minutes < SKY_STOPS[i].time) {
      // The prior item and this item bound the current time interval.
      next = SKY_STOPS[i];

      previous = SKY_STOPS[Math.max(0, i - 1)];

      break;
    }
  }
  if (minutes >= TIME.night) {
    // Extend the first midnight color to 24:00 so late-night interpolation is continuous.
    previous = SKY_STOPS[SKY_STOPS.length - 1];

    next = {
      ...SKY_STOPS[0],
      time: 24 * 60,
    };
  }

  return {
    previous,
    next,
  };
}

/*
   Update sky colors.
*/
function updateSky(minutes) {
  const { previous, next } = getSkyStops(minutes);

  // Compute progress inside the current keyframe interval, including across midnight.
  let range = next.time - previous.time;

  // A negative range indicates an interval that wraps from the last stop to midnight.
  if (range <= 0) {
    range += 24 * 60;
  }

  let current = minutes - previous.time;

  if (current < 0) {
    current += 24 * 60;
  }

  const progress = clamp(current / range);

  // Update the three CSS gradient stops; CSS transitions animate the visual change.
  root.style.setProperty(
    "--sky-top",
    interpolateColor(previous.top, next.top, progress),
  );

  root.style.setProperty(
    "--sky-middle",
    interpolateColor(previous.middle, next.middle, progress),
  );

  root.style.setProperty(
    "--sky-bottom",
    interpolateColor(previous.bottom, next.bottom, progress),
  );
}

// CELESTIAL OBJECTS
function updateSun(minutes) {
  let progress;

  // Normalize the daylight interval to 0..1; outside it, use the starting position.
  if (minutes >= TIME.sunrise && minutes <= TIME.sunset) {
    progress = mapRange(minutes, TIME.sunrise, TIME.sunset, 0, 1);
  } else {
    progress = 0;
  }

  // A half sine wave produces a simple arc: low at sunrise/sunset, high at midday.
  const angle = Math.PI * progress;

  const x = lerp(7, 93, progress);

  const y = 62 - Math.sin(angle) * 49;

  // Hide the sun outside the configured daylight interval.
  let opacity = 1;

  if (minutes < TIME.sunrise) {
    opacity = 0;
  } else if (minutes > TIME.sunset) {
    opacity = 0;
  }

  // Slightly reduce the sun's size through golden hour.
  let scale = 1;

  if (minutes >= TIME.goldenStart && minutes <= TIME.sunset) {
    const goldenProgress = mapRange(
      minutes,
      TIME.goldenStart,
      TIME.sunset,
      0,
      1,
    );

    scale = lerp(1, 0.86, goldenProgress);
  }

  root.style.setProperty("--sun-x", `${x}%`);

  root.style.setProperty("--sun-y", `${y}%`);

  root.style.setProperty("--sun-opacity", opacity);

  root.style.setProperty("--sun-scale", scale);
}

function updateMoon(minutes) {
  let nightProgress = 0;

  let visible = 0;

  if (minutes >= TIME.night || minutes < TIME.sunrise) {
    visible = 1;

    let nightMinutes;

    if (minutes >= TIME.night) {
      nightMinutes = minutes - TIME.night;
    } else {
      // Continue the evening count after midnight instead of resetting the moon's path.
      nightMinutes = minutes + (24 * 60 - TIME.night);
    }

    // Night is split across midnight: evening duration plus the early-morning duration.
    const totalNight = TIME.sunrise + (24 * 60 - TIME.night);

    nightProgress = clamp(nightMinutes / totalNight);
  }

  // Reuse a half-sine arc, moving the moon from right to left overnight.
  const angle = Math.PI * nightProgress;

  const x = lerp(78, 20, nightProgress);

  const y = 57 - Math.sin(angle) * 43;

  root.style.setProperty("--moon-x", `${x}%`);

  root.style.setProperty("--moon-y", `${y}%`);

  root.style.setProperty("--moon-opacity", visible);
}

// NIGHTTIME ATMOSPHERE
function updateStars(minutes) {
  let opacity = 0;

  // Fade stars from invisible at sunset to fully visible at the configured night time.
  if (minutes >= TIME.sunset && minutes < TIME.night) {
    opacity = mapRange(minutes, TIME.sunset, TIME.night, 0, 1);
  }

  // Keep them visible overnight, then reduce their opacity toward sunrise.
  if (minutes >= TIME.night) {
    opacity = 1;
  }

  if (minutes < TIME.sunrise && minutes > 0) {
    opacity = mapRange(minutes, 0, TIME.sunrise, 1, 0);
  }

  root.style.setProperty("--stars-opacity", clamp(opacity));
}

function updateNightAtmosphere(minutes) {
  let opacity = 0;

  // Darken the sky between dusk and the start of the full-night interval.
  if (minutes >= TIME.dusk && minutes < TIME.night) {
    opacity = mapRange(minutes, TIME.dusk, TIME.night, 0, 1);
  }

  // Begin the early-morning fade after assigning the fully dark night state.
  if (minutes >= TIME.night || minutes < TIME.sunrise) {
    opacity = 1;
  }

  // Fade the overlay from midnight through sunrise using this implementation's schedule.
  if (minutes >= 0 && minutes < TIME.sunrise) {
    opacity = mapRange(minutes, 0, TIME.sunrise, 1, 0);
  }

  root.style.setProperty("--night-opacity", clamp(opacity));
}

// CLOUDS AND GOLDEN-HOUR EFFECTS
function updateClouds(minutes) {
  let opacity = 0.8;

  let brightness = 1;

  // Interpolate cloud visibility and brightness while sunset progresses into night.
  if (minutes >= TIME.sunset && minutes < TIME.night) {
    const progress = mapRange(minutes, TIME.sunset, TIME.night, 0, 1);

    opacity = lerp(0.8, 0.25, progress);

    brightness = lerp(1, 0.65, progress);
  }

  if (minutes >= TIME.night || minutes < TIME.sunrise) {
    opacity = 0.18;
    brightness = 0.55;
  }

  root.style.setProperty("--cloud-opacity", opacity);

  root.style.setProperty("--cloud-brightness", brightness);
}

function updateGoldenHour(minutes) {
  let opacity = 0;

  // Only apply the overlay between the configured golden-hour start and sunset.
  if (minutes >= TIME.goldenStart && minutes <= TIME.sunset) {
    const progress = mapRange(minutes, TIME.goldenStart, TIME.sunset, 0, 1);

    /*
           Fade in, reach strongest point,
           then slightly fade toward sunset.
        */

    if (progress < 0.5) {
      opacity = mapRange(progress, 0, 0.5, 0, 1);
    } else {
      opacity = mapRange(progress, 0.5, 1, 1, 0.55);
    }
  }

  root.style.setProperty("--golden-opacity", opacity);
}

function updateReflection(minutes) {
  let opacity = 0.3;

  // Golden hour uses a stronger reflection than the default daytime setting.
  if (minutes >= TIME.goldenStart && minutes <= TIME.sunset) {
    opacity = 0.65;
  }

  // Reduce reflection intensity at night; the current CSS reflection still follows --sun-x.
  if (minutes >= TIME.night || minutes < TIME.sunrise) {
    opacity = 0.18;
  }

  root.style.setProperty("--reflection-opacity", opacity);
}

// CABIN LIGHTS
function updateCabinLights(minutes) {
  let light = 0;

  // Fade the lights from off at dusk to full intensity at the night boundary.
  if (minutes >= TIME.dusk && minutes < TIME.night) {
    light = mapRange(minutes, TIME.dusk, TIME.night, 0, 1);
  }

  // Keep the lights on throughout the night and the pre-dawn hours.
  if (minutes >= TIME.night || minutes < 5 * 60) {
    light = 1;
  }

  // Fade them out between 5:00 AM and sunrise.
  if (minutes >= 5 * 60 && minutes < TIME.sunrise) {
    light = mapRange(minutes, 5 * 60, TIME.sunrise, 1, 0);
  }

  root.style.setProperty("--cabin-light", clamp(light));
}

// TEXT AND TIMELINE
function updateText(minutes) {
  let greeting = "Good afternoon";

  let description = "A quiet afternoon by the lake.";

  // The ordered conditions select the first matching local-time interval.
  if (minutes >= 5 * 60 && minutes < TIME.sunrise) {
    greeting = "Good morning";

    description = "The world is slowly waking up.";
  } else if (minutes >= TIME.sunrise && minutes < 12 * 60) {
    greeting = "Good morning";

    description = "Soft daylight settles over the lake.";
  } else if (minutes >= 12 * 60 && minutes < TIME.goldenStart) {
    greeting = "Good afternoon";

    description = "A bright, quiet afternoon by the water.";
  } else if (minutes >= TIME.goldenStart && minutes < TIME.sunset) {
    greeting = "Golden hour";

    description = "The lake catches the last warm light.";
  } else if (minutes >= TIME.sunset && minutes < TIME.night) {
    greeting = "Good evening";

    description = "Daylight is giving way to a quiet dusk.";
  } else {
    greeting = "Good night";

    description = "The cabin lights glow beneath the stars.";
  }

  greetingElement.textContent = greeting;

  descriptionElement.textContent = description;
}

function updateTimeline(minutes) {
  // Default to night so the late-night and pre-dawn intervals have a phase.
  let activePhase = "night";

  if (minutes >= TIME.sunrise && minutes < TIME.goldenStart) {
    activePhase = "day";
  }

  if (minutes >= TIME.goldenStart && minutes < TIME.sunset) {
    activePhase = "golden-hour";
  }

  if (minutes >= TIME.sunset && minutes < TIME.night) {
    activePhase = "sunset";
  }

  phaseElements.forEach((phase) => {
    const phaseName = phase.dataset.phase;

    phase.classList.toggle("active", phaseName === activePhase);
  });

  // Scale the progress bar by elapsed minutes out of the entire 1,440-minute day.
  const progress = minutes / (24 * 60);

  timelineProgress.style.transform = `scaleX(${clamp(progress)})`;
}

// Keep assistive-technology text in sync with the visible clock and scene.
function updateAccessibility(time) {
  const formatted = formatTime(time);

  liveStatus.textContent =
    `The scene is currently showing ` + `${formatted.short} local time.`;
}

// MAIN UPDATE ORCHESTRATOR
function updateScene() {
  const currentTime = getCurrentTime();

  const minutes = getMinutesOfDay(currentTime);

  // Refresh every part from the same time snapshot to keep the scene consistent.
  updateClock(currentTime);

  updateSky(minutes);

  updateSun(minutes);

  updateMoon(minutes);

  updateStars(minutes);

  updateNightAtmosphere(minutes);

  updateClouds(minutes);

  updateGoldenHour(minutes);

  updateReflection(minutes);

  updateCabinLights(minutes);

  updateText(minutes);

  updateTimeline(minutes);

  updateAccessibility(currentTime);
}

// Render immediately so the correct scene appears without waiting for the timer.
updateScene();

// Keep the displayed clock and computed scene synchronized with local device time.
if (!TEST_MODE) {
  setInterval(updateScene, 1000);
}

// Background tabs may throttle timers; recalculate from the current clock on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateScene();
  }
});
