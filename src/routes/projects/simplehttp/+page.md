Lightweight and simple http library implementation for building internal server endpoints.

## Purpose

The purpose of SimpleHTTP is to provide an extremely simple implementation of an HTTP/1.1 compatible server library.

With SimpleHTTP you should be able to build simple internal server endpoints like a meta-api/hook that does not require advanced security features or TLS.


The initial use case for SimpleHTTP was to build the Metahook for the `Cthulhu` project I was working on, this hook is hosted on a local unix socket communicating with
applications like a juju controller. For this type of communication, SimpleHTTP is a good choice, as it consists of just one single lightweight header file and has no external dependencies.

## Implementation

SimpleHTTP is implemented in a single header file using no external dependencies. 

It implements a non-blocking eventloop that uses `coroutines` to "pause" and schedule handlers while waiting for IO operations to be performed.


The underlying event system is driven by the linux kernel `epoll_instance` which receives a notification when filedescriptors of the sockets are ready to read/write.

This implementation ensures that the server can process multiple requests very efficiently.


## Lessons Learned

Building SimpleHTTP taught me a lot, I learned about how the HTTP/1.1 standard works and immersed deep into the world of linux socket programming.


Besides that, I spent countless hours deliberating about how to implement various components of SimpleHTTP which was not only fun, but also improved my problem solving skills.


While adding the library to the Bazel-Central-Registry, I also became acquainted with the new Bazel bzlmod system.


Even when learning many things in this project, I'm a bit disappointed by how long it took me to implement this library. I often could not focus or concentrate enough to work on this productively, which I definitely want to optimize in the future.
