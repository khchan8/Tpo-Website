# Flowing Energy Stream Background Implementation Guide (Section-Specific)

## Overview

This guide provides detailed instructions and code for an AI agent to replace static background images within the `#hero` and `#cta` sections of an `index.html` file with a dynamic, visually stunning "Flowing Energy Stream" effect. This effect is designed to closely replicate the reference video/image, featuring a layered, glowing blue energy ribbon with integrated particles.

The target visual effect includes:
*   A central, fluid energy stream composed of **multiple overlapping, translucent wave layers**.
*   A vibrant **cyan-blue color palette** with a bright core and softer, fading edges, achieved through layering and glow.
*   Subtle, **fine particles** embedded within or moving alongside the stream, adding texture and a sense of energy.
*   Smooth, continuous, **complex wave animation**, creating an organic flow rather than a simple sine wave.
*   A **black background** specifically within the `#hero` and `#cta` sections where the effect is applied.
*   The effect is **strictly confined** to the bounds of the `#hero` and `#cta` container elements.

## Prerequisites

1.  **Access to Website Files:** Need to modify `index.html` and the relevant CSS file (assume `assets/css/style.css`).
2.  **Text Editor / Development Environment:** Standard tools for web development.
3.  **Basic HTML/CSS/JS Knowledge (Agent):** The AI should understand how to parse and apply these web technologies. (Simplex Noise library is **not** strictly required, as the core flow can be achieved by summing multiple complex sine waves, but could be added for extra particle randomness if desired).

---

## Instructions

**Phase 1: Analysis & Preparation**

1.  **Analyze `index.html`:** Identify the exact structure of the `#hero` and `#cta` sections. Note any direct child elements that contain the primary content (text, buttons, images).
2.  **Analyze `assets/css/style.css`:** Locate the CSS rules targeting `#hero` and `#cta`. Specifically find and note the lines containing `background`, `background-image`, or related properties that apply `hero-bg.jpg` and `cta-bg.jpg`.

**Phase 2: Code Generation**

**1. HTML Modifications (`index.html`)**

*   **Inside `#hero`:** Generate HTML to insert a `<canvas>` element just before the closing tag (`</section>` or `</div>`) of the `#hero` element. Assign it a specific class and an optional ID.
    ```html
    <!-- Inside the #hero section, before its closing tag -->
    <canvas class="energy-stream-canvas" id="hero-energy-stream"></canvas>
    ```
*   **Inside `#cta`:** Generate similar HTML to insert another `<canvas>` with the *same class* just before the closing tag of the `#cta` element.
    ```html
    <!-- Inside the #cta section, before its closing tag -->
    <canvas class="energy-stream-canvas" id="cta-energy-stream"></canvas>
    ```

**2. CSS Modifications (`assets/css/style.css`)**

*   **Remove Old Backgrounds:** Generate instructions/diffs to remove the previously identified `background` / `background-image` properties from the `#hero` and `#cta` CSS rules.
*   **Add New CSS Rules:** Generate the following CSS to style the sections and the canvases within them:

    ```css
    /* --- Flowing Energy Stream Background Styles (Section-Specific) --- */

    #hero,
    #cta {
        position: relative; /* Essential for positioning the absolute canvas inside */
        overflow: hidden; /* Keep the effect contained */
        /* Remove background image properties here */
        background: #000000 !important; /* Set explicit black background for the section */
        /* Adjust padding if needed to prevent content overlap */
        /* padding: 80px 20px; Example */
    }

    .energy-stream-canvas {
        position: absolute; /* Position relative to the parent section */
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0; /* Behind the direct content children */
        pointer-events: none; /* Interaction passes through */
        display: block;
    }

    /* Ensure Section Content is Above the Canvas */
    /* Target direct children or specific important elements */
    #hero > *,
    #cta > * {
        position: relative; /* Necessary for z-index */
        z-index: 1; /* Position above the canvas (z-index: 0) */
        color: #ffffff; /* Ensure text is visible on black background */
        /* Add other styles as needed */
    }

    /* Fallback/Alternative: Target specific known content elements */
    /*
    #hero h1, #hero p, #hero .btn,
    #cta h2, #cta p, #cta .btn {
        position: relative;
        z-index: 1;
        color: #ffffff; /* Adjust color if necessary */
    }
    */

    /* --- End Flowing Energy Stream Background Styles --- */
    ```

**3. JavaScript Code Generation (`index.html`)**

*   Generate the following JavaScript code block to be placed just before the closing `</body>` tag in `index.html`. This code implements the multi-layered stream and particle effect.

    ```javascript
    <script>
    // --- Flowing Energy Stream Effect (Section Specific) ---
    window.addEventListener('load', function() {

        const canvases = document.querySelectorAll('.energy-stream-canvas');
        if (canvases.length === 0) {
            console.warn("No elements with class '.energy-stream-canvas' found.");
            return;
        }

        let animationFrameId = null;
        let time = 0; // Shared time/phase offset

        // --- Effect Configuration ---
        const config = {
            streamColor: 'hsl(195, 100%, 65%)', // Base bright cyan-blue
            glowColor: 'hsla(195, 100%, 75%, 0.5)', // Lighter glow
            glowBlur: 18,
            numStreamLayers: 8, // Number of overlapping wave lines for the stream
            streamLineWidthBase: 0.5, // Base thickness, layers will vary
            streamAlphaBase: 0.05,   // Base alpha, layers will vary (additive)
            numParticles: 150,       // Number of particles per canvas
            particleColor: 'hsla(195, 100%, 85%, 0.7)', // Slightly lighter, less saturated
            particleSize: 0.8,
            particleSpeedFactor: 0.5
        };

        // Wave parameters for each layer (example: vary frequency, amplitude, speed)
        const layerParams = [];
        for (let i = 0; i < config.numStreamLayers; i++) {
            layerParams.push({
                // More complex waves towards the center might have lower frequency, higher amplitude
                freq1: 0.005 + Math.random() * 0.01, // Base wave frequency
                amp1: 20 + Math.random() * 30,       // Base wave amplitude
                speed1: 0.01 + Math.random() * 0.01, // Base wave speed
                freq2: 0.01 + Math.random() * 0.03, // Secondary ripple frequency
                amp2: 5 + Math.random() * 15,       // Secondary ripple amplitude
                speed2: 0.02 + Math.random() * 0.03, // Secondary ripple speed
                phaseOffset: Math.random() * Math.PI * 2, // Start phase variation
                alpha: config.streamAlphaBase + (Math.random() * 0.1), // Vary alpha per layer
                lineWidth: config.streamLineWidthBase + Math.random() * 1.0 // Vary thickness
            });
        }

        const activeCanvases = []; // Store { canvas, ctx, width, height, particles }

        // --- Particle Class ---
        class Particle {
            constructor(canvasWidth, canvasHeight, streamCenterYFunc) {
                this.width = canvasWidth;
                this.height = canvasHeight;
                this.getStreamCenterY = streamCenterYFunc; // Function to get stream y at particle x
                this.reset();
            }

            reset() {
                this.x = Math.random() * this.width;
                this.y = Math.random() * this.height; // Start anywhere, will snap towards stream
                this.vx = (Math.random() - 0.5) * 2 * config.particleSpeedFactor;
                this.vy = (Math.random() - 0.5) * 0.5 * config.particleSpeedFactor;
                this.life = 0;
                this.maxLife = 50 + Math.random() * 100;
                this.alpha = 0;
                this.targetAlpha = 0.5 + Math.random() * 0.4;
            }

            update() {
                this.life++;

                // Gently pull towards the stream's current vertical position
                const streamY = this.getStreamCenterY(this.x);
                this.vy += (streamY - this.y) * 0.005 * config.particleSpeedFactor;

                // Add small random drift
                this.vx += (Math.random() - 0.5) * 0.1 * config.particleSpeedFactor;
                this.vy += (Math.random() - 0.5) * 0.1 * config.particleSpeedFactor;

                // Damping
                this.vx *= 0.96;
                this.vy *= 0.96;

                this.x += this.vx;
                this.y += this.vy;

                // Fade in/out
                 if (this.life < 30) this.alpha += (this.targetAlpha - this.alpha) * 0.1;
                 else this.alpha += (this.targetAlpha - this.alpha) * 0.05;


                // Reset Check
                if (this.life > this.maxLife || this.alpha < 0.01 || this.x < -10 || this.x > this.width + 10) {
                    this.reset();
                    this.y = this.getStreamCenterY(this.x) + (Math.random() - 0.5) * 50; // Reset near stream
                    this.alpha = 0; // Ensure fade-in on reset
                }
            }

            draw(ctx) {
                if (this.alpha <= 0.01) return;
                ctx.fillStyle = `hsla(195, 100%, 85%, ${this.alpha * 0.7})`; // Use particle color base
                ctx.beginPath();
                ctx.arc(this.x, this.y, config.particleSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }


        // --- Setup and Drawing ---
        function setupCanvas(canvas) {
            const ctx = canvas.getContext('2d');
            if (!ctx) { console.error("No context for", canvas.id); return null; }

            const parentRect = canvas.parentElement.getBoundingClientRect();
            canvas.width = parentRect.width || 300; // Fallback width
            canvas.height = parentRect.height || 150; // Fallback height

            // Function to estimate stream center Y at a given X for particles
            // This is an approximation based on the average of layer parameters
            const getStreamCenterY = (xPos) => {
                 let avgY = canvas.height / 2;
                 let totalAmpEffect = 0;
                 layerParams.forEach((p, i) => {
                     const phase1 = time * p.speed1 + p.phaseOffset;
                     const phase2 = time * p.speed2 * (i % 2 === 0 ? 1 : -1.1) + p.phaseOffset; // Vary ripple phase/direction
                     const freqScale = (Math.PI / 180) * (canvas.width / 150); // Scale frequency roughly with width
                     const y1 = Math.sin(xPos * p.freq1 * freqScale + phase1) * p.amp1;
                     const y2 = Math.sin(xPos * p.freq2 * freqScale + phase2) * p.amp2;
                     totalAmpEffect += (y1 + y2);
                 });
                 return avgY + (totalAmpEffect / layerParams.length) * 0.8; // Return average y offset
            };


            const particles = [];
            for (let i = 0; i < config.numParticles; i++) {
                particles.push(new Particle(canvas.width, canvas.height, getStreamCenterY));
            }

            return { canvas, ctx, width: canvas.width, height: canvas.height, particles, getStreamCenterY };
        }

        function drawEffect(canvasData) {
            const { canvas, ctx, width, height, particles, getStreamCenterY } = canvasData;
            const centerY = height / 2;

            // Clear with slight fade for motion blur / trails
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; // Adjust alpha for trail length
            ctx.fillRect(0, 0, width, height);

            // --- Draw Stream Layers ---
            ctx.save(); // Save context state
            ctx.globalCompositeOperation = 'lighter'; // Additive blending for glow
            ctx.shadowColor = config.glowColor;
            ctx.shadowBlur = config.glowBlur;

            layerParams.forEach((p, i) => {
                ctx.beginPath();
                ctx.lineWidth = p.lineWidth;
                // Make center layers slightly brighter in base color
                const layerBrightness = 70 + Math.sin(i / config.numStreamLayers * Math.PI) * 10;
                ctx.strokeStyle = `hsla(195, 100%, ${layerBrightness}%, ${p.alpha})`;

                for (let x = -10; x < width + 10; x += 5) { // Draw slightly off-screen for smooth edges
                    let y = centerY;
                    const phase1 = time * p.speed1 + p.phaseOffset;
                    const phase2 = time * p.speed2 * (i % 2 === 0 ? 1 : -1.1) + p.phaseOffset;
                    const freqScale = (Math.PI / 180) * (width / 150); // Scale frequency roughly
                    const y1 = Math.sin(x * p.freq1 * freqScale + phase1) * p.amp1;
                    const y2 = Math.sin(x * p.freq2 * freqScale + phase2) * p.amp2;
                    y += y1 + y2; // Sum wave components

                    if (x <= -5) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
            });
            ctx.restore(); // Restore context state (removes shadow, composite op)

            // --- Draw Particles ---
            // (Draw particles after stream and without glow/lighter for clarity)
            particles.forEach(p => {
                p.update(); // Update particle position and state
                p.draw(ctx);
            });
        }

        // --- Animation Loop ---
        function loop() {
            time += 1; // Increment time

            activeCanvases.forEach(canvasData => {
                if (canvasData) drawEffect(canvasData);
            });

            animationFrameId = requestAnimationFrame(loop);
        }

        // --- Initialization and Resize ---
        function initialize() {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            activeCanvases.length = 0; // Clear array

            canvases.forEach(canvas => {
                const canvasData = setupCanvas(canvas);
                if (canvasData) activeCanvases.push(canvasData);
            });

            if (activeCanvases.length > 0) loop();
        }

        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(initialize, 250);
        });

        // --- Start ---
        initialize();

    }); // End window.onload
    </script>
    ```

**Phase 3: Implementation and Testing**

1.  **Apply Changes:** Use the generated HTML additions and CSS modifications/removals on the target files (`index.html`, `assets/css/style.css`). Add the generated JavaScript block to `index.html`.
2.  **Test:**
    *   Load `index.html` in a browser.
    *   **Verify Visuals:** Do `#hero` and `#cta` have black backgrounds? Is there a flowing, layered blue stream effect within each? Does it glow? Are there small blue particles moving with/around the stream? Does it closely resemble the reference image's feel?
    *   **Verify Containment:** Is the effect strictly within the bounds of the `#hero` and `#cta` sections?
    *   **Verify Content:** Is all text/button content within `#hero`/`#cta` visible *on top* of the effect? Check contrast.
    *   **Verify Performance:** Is the animation smooth? Check the console (F12) for errors. If laggy, reduce `config.numStreamLayers`, `config.numParticles`, or `config.glowBlur` in the JS.
3.  **Refine (AI Task):** Based on visual discrepancies or performance issues noted during testing, instruct the AI to adjust parameters within the `config` object or the `layerParams` generation logic in the JavaScript. Examples:
    *   "Make the stream glow brighter": Increase `config.glowBlur` or alpha in `config.glowColor`.
    *   "Increase particle density": Increase `config.numParticles`.
    *   "Make the central stream waves larger": Adjust `amp1` range in `layerParams`.
    *   "Improve performance": Decrease `config.numStreamLayers` and `config.numParticles`.

**Phase 4: Finalization**

*   Present the final working code and confirm successful implementation.

---

## Troubleshooting Notes for AI

*   **Canvas/Context Errors:** Ensure canvas elements exist and `getContext('2d')` succeeds.
*   **Positioning Issues:** Double-check CSS: `position: relative` on sections, `position: absolute` on canvas, correct `z-index` stack (content `z-index: 1`, canvas `z-index: 0`). Ensure `overflow: hidden` on sections.
*   **Performance Bottlenecks:** Likely culprits are high particle counts, many stream layers, large glow blur radius, or complex calculations per frame. Reduce these values first.
*   **Visual Mismatch:** Requires adjusting wave parameters (`layerParams`), colors, alphas, line widths, particle behavior (`Particle` class logic), or the background clear alpha (`rgba(0,0,0, A)`).
