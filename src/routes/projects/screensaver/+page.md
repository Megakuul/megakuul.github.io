Drippin windows screensaver rendering on the CPU like a real gigachad (give me an award for this logo).

## Purpose

You know how it is in medieval ages, there is a high demand for screen savers (to save screens).

So after creating such a screen saver at work, I thought, let's rebuild this, but with cool things like frame-rate synchronization, collision and bounce effects.

## Implementation

The screen saver is implemented in raw gigachad C using the old-ass windows gdi32 interface.

Unfortunately, I discovered that gdi32 is very limited when it comes to ... uh ... everything. For that reason, I implemented way too complex things just to make a painter floating around on a screen.


First there is an eventloop which is used to draw the images to the window, then we have a processor loop for every window which, for performance reasons, runs on a separate thread. This processor loop handles image movement, collision, and bounce before sending a request to the eventloop to update the UI.
The collision and bounce system was self-implemented and is therefore probably not very efficient (but who cares, I mean people using windows don't care about efficiency).


When we update the image position in a constant interval controlled by something like "Sleep()", this will lead to major frame overlapping that makes the movement look very unsmooth. For this reason, the window processor loops are using a high-precision timer in combination with a "spin-lock-like" sleeper that does not rely on the inaccurate "Sleep()" syscall. The loops' interval is then synchronized with the monitor frame rate to reduce frame overlapping.



## Lessons Learned

Besides acknowledging that I will never use windows for any job where I want to be actually productive, I strengthened my problem solving skills by contemplating stuff gdi32 seemed to have forgotten to implement.


I also learned about some fundamental concepts used at the lower levels of graphic processing.
