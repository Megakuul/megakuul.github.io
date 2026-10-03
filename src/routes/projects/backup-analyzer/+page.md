The **Backup Analyzer** is a simple web tool for the analysis of backup strategies and retentions.

## Purpose

Since backups are frequently viewed as auxiliary, many companies overlook the importance of adopting robust and reliable backup solutions.

My aim was to create a simple tool that can help to build reliable backup solutions. 

## Implementation

Given that this project is really simple, there is not much to say about the implementation.
The application splits up into two parts, the **Infrastructure Builder** and the **Backup Calculator**. 

**Infrastructure Builder** is basically just a set of standardized backup strategies for different use cases; the builder shows what combinations of those strategies build up a valid **3-2-1-1** state.

On the other hand, we have the **Backup Calculator**, which is a visualizer for backup retention policies. It can visualize a retention policy and calculate the estimated backup size based on default configuration options that are found, e.g. in the **Veeam Backup & Replication** software.
For calculating the retention policy, it uses a processor that operates very similarly to Veeams own retention processor.

For quick exchange of backup retention policies, there is a built-in Redis data store that will let you generate a public link for your configuration. The database for this runs directly on **Vercels** managed infrastructure and is connected via a simple **SvelteKit** server function.

## Lessons Learned

Besides some relaxed frontend programming, this project got me reading a lot of Veeam's docs and thinking about how to set up a backup infrastructure in a reasonable way.
