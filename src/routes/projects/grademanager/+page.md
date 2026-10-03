**GradeManager** is an software that should help people manage their school grades.

## Purpose

The **GradeManager** project started when I created the **Legacy GradeManager** with the **.Net Framework**, just for a friend of mine.

After seeing the demand for applications like **Pluspoints**, I thought it is time to create an Opensource Cross-Platform application that can handle these things.

## Implementation

How already said, the first version of the **GradeManager** (now called **Legacy GradeManager**) was created with **Windows Forms**, a UI Framework from **.Net**. It is really simple and only compatible with Windows.

The new version of the **GradeManager** was built using **Dart** with **Flutter** as the UI framework, as I wanted the application to be cross-platform, and I already had some experience with **Flutter**.

Over the whole project I tried to stick to the **Flutter standard library**, by that I kept most forms and fields a bit  standardized.
And I also made the configuration human-readable so that anyone can easily make their own changes to the config. Furthermore, I built functions to export the configuration and to import configurations from the **Legacy GradeManager** and **Pluspoints**.

Additionally, I've created a **GitHub Workflow** that builds the **GradeManager** for Windows, Linux, Android and macOS and then adds them to the **GradeManager Website**. The Windows **GradeManager** also gets automatically shipped with an automated **Inno Setup** Installer.

Since I'm not 18 years old right now, I had not the chance to  get an Apple/Google Developer account, this is why until now, the App is neither in the **App Store** nor the **Google Play Store**.

## Lessons Learned

While building the **GradeManager** I've learned many concepts used by UI-Frameworks and how they are solved (e.g. widget-tree, state-management). 
It has definitely helped me strengthen my skills in Flutter.

In the application there are a lot of weird/confusing patterns, for somehow I did not separate the UI from the actual logic too good.

I suppose it's not terrible, but that's the main thing I'd like to improve on, the rest of the application is, in my opinion, pretty well done.
