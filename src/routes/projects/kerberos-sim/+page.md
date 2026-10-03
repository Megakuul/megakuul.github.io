**Kerberos Simulator** is system to simulate the Kerberos authentication protocoll.

## Purpose

Although Kerberos is labeled as an "old" and "complex" protocol, it is actually a beautiful option for SSO authentication. 

This project aims to simulate the steps of Kerberos in a very simple environment.

In addition, some more contemporary technologies have been sprinkled into the project.

## Implementation

To simulate the Kerberos environment, I implemented the following independent applications:

- **Client**
- **Service**
- **KDC**

Since I also share libraries and code between those services, I used **Bazel** as a building tool for this project. Bazel allows me to create rules to build every application independently while still sharing dependencies with each other.

For the implementation of the applications, I chose **GO** as the language due to its high priority on simplicity. GO is also a great choice for system services like this in general, which makes it a very appropriate choice for me.

I decided to use raw **UDP** sockets in conjunction with **Protocol Buffers**, this is a small change to the similar but not as efficient **Abstract Syntax Notation One** serialization method that is used by **MIT Kerberos**.

Given that this should be a simulated environment, data is read from a simple "yaml" representation instead of a real database, which allows the project to run basically out of the box.


## Lessons Learned

By implementing this project, I took a deep dive into the Kerberos protocol; I studied the MIT Kerberos docs (which are pretty interesting, btw) and learned a lot in terms of how SSO authentication works.

I also got to know the Bazel build tool, a tool that I will eventually use more often in the future.
