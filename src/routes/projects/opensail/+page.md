Sophisticated regatta rating system that is so transparent, since it dropped, it has become pretty quiet around Ignotus Peverell's cloak.

## Purpose

This project is part of a final thesis about regatta sailing. For the thesis, I researched various systems that handicap different boats in regattas (without a handicap, regattas are basically supercell-level pay-to-win). During my journey, I found various interesting concepts. For example, there is [ORC](https://orc.org), a company that measures vessels and then uses a velocity prediction program to analyze the boat's speed from different angles. On the other hand, there are local systems such as the Yardstick, which use empirical values and determine the factor of a ship as if they were Caesar judging a gladiator.


What I discovered are interesting approaches that, even if mature, often result in vague outcomes. The thing that bothers me the most about all of these systems, however, is that they do not transparently show WHY ships received their ratings. So, I decided, as part of the thesis, that a transparent ship database with associated handicap mechanism must be created.


## Implementation

My mom always used to say that "nothing is free." Well, she didn't know about the marketing strategy "vendor locking". Opensail essentially "exploits" the free Github open-source ecosystem for its entire application logic. The project is essentially a single Github repository that stores data directly within the SvelteKit static assets. Yeah, you heard that right... The database IS the repository.

The genius behind this project is its scalability. Unlike many other projects, this has a fixed and clear scaling cap: the number of ships participating in regattas worldwide. Fortunately, all of these ships, even with extensive metadata, fit into less than 30MB json. This not only means we can store it within the revision control system, but also that we can serve the data directly from an aws cloudfront cdn.

Even better, we have a fully-fledged search engine that can find any word within seconds — it's called string.includes(). You can probably see where this is going: the point is that, even at maximum scale, this project is far faster, simpler, and cheaper than other scalable solutions. Searching for a term in 30MB takes under a second. If you're not paying a software developer's annual salary for ec2 machines hosting elasticsearch, you likely won't match that speed.


Luckily, there is also a hosting provider called [Battleshiper](https://battleshiper.dev) that provides this project with free, blazingly fast, globally cached hosting (big thanks to the mightiest of mighty who created this excellent product).


The algorithm used to calculate the handicap factor of boats is a mix of static specification values of the boat and empirical constants used for calibration. The best part is that you can transparently view all ships, their specifications, and the factor calculations on the website. This makes it a far more enjoyable experience than paying 40 CHF to get an arbitrary Yardstick number from Swiss Sailing.


## Lessons Learned

Besides learning a lot about how sailing in general works, I also discovered many features (and caveats) of Github repositories and their workflows.


It's actually crazy to see how much Github has to offer. Before this, I thought Github was just a poorly implemented version of Gitlab that only gained traction because of its popularity. Now, I still hold the exact same belief, but at least I can now proudly stand behind my belief.


Overall, this project was still very interesting and, once again, a perfect opportunity for my brain to sneak away from the really important projects.
