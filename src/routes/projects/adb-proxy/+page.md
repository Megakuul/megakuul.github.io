Proof of concept proxy allowing central management of android devices via adb.

## Purpose

There are days when I finally want to continue with my running projects, but y'all know how it is...


This project is yet another failure of my brains' ability to finish stuff.
After a brief discussion with my dad about how Android devices can be managed via scrcpy (a cool remote phone management program), I wanted to have a centrally managed proxy where Android devices can register themselves. Allowing me to connect, without manually authorizing the phone with my computer.


## Implementation

The adb-proxy is composed of two parts, the server and the client. The server component, written in Go, runs on a central server listening to a specific tcp port.

With the client installed on the Android device, you can now connect to the proxy server that mirrors the internal adb port (android development bridge).


Communication is initiated by the client, which opens a tcp stream, in which it first sends a small information header. This header contains information about the device, such as the device name or ip address. The device information is then accessible via a rest api provided by the proxy server.


After establishment of the communication, the tcp stream is kept open and proxied to the local adb port on the device. Since the connection is initiated by the client, I can connect to devices to which I have no direct network access.

For example, this system would allow clients to connect to a public proxy server (with a TLS certificate, of course) so that users can connect to a device regardless of its network or location.


## Lessons Learned

I got a massive headache as I was inhumanly and brutally forced to: use the android build system, beg android for permissions and, worst of all, dip my toe into the water (or more like sewage) of Java.

When disregarding the permanent damage Java caused to my brain, I learned much about how the android ecosystem works, especially in the area of the android development bridge.
