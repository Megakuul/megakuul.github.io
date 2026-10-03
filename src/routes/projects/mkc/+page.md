The **Megakuul Commander** (short MKC) is a lightweight application for managing the filesystem, that got inspired by the **Total Commander**.  

## Purpose

**MKC** is intendant to be a convenient way to view and manage files under **Linux**, as the default **GNOME File Explorer** is missing many features and is not really optimized for a fast workflow. The Megakuul Commander aims to simplify everything, while offering shortcuts for operations to boost efficiency.  


## Implementation

I was genuinely interested in **C++**, even though it is not mundane to learn this language today. With **C++**, I can gain a better understanding of low-level system programming.

As the build tool, I chose **CMake**, as it is just the first I found, and is also the common tool for a lot of software projects.

For the UI I first looked into the **Qt Framework**, but in **Qt** the building process is very complex and mostly done automatically from their own tools like **Qt Creator**. 
So, that's why I decided to use **GTK (GTKMM 3.0)**, as it is a cross-plattform UI Framework, that, unlike **Qt**, can be easily used with **VSCode** and **CMake**, without having too much "black magic" from the Framework.

I tried to separate the application into three parts:

- fsutil
- bridge
- UI Components

Whereas the fsutil directly interacts with the filesystem. The bridge connects the fsutil with the main UI.

## Lessons Learned

Currently, the project does not have too many features. The main difficulties I have encountered are finding a consistent programming pattern. 
As I have not previously used **C++**, it was a significant challenge in determining the appropriate patterns, as a significant number of libraries and principles in **C++** operate in a fundamentally different way from those of programming languages I used previously.

In the whole application, there are many variables that are named in a perplexing way. This is also something I need to keep an eye on while building such a software.

**Update 16.12.2023**:

I was able to refactor the code to make conventions more consistent and streamline the operations more through this fsutil-bridge-ui model. It's still not perfect, but it's going in the right direction, I think.

This month, I also created a CI/CD Pipeline to upload the MKC package to a Launchpad PPA. Although I encountered numerous challanges in making this process work, it also allowed me to delve into the world of packaging systems (especially for Ubuntu and Arch). This experience helped me understand the key points of various packaging solutions.
