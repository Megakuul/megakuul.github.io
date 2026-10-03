Gorbit is a fast and simple loadbalancer that operates based on **TCP** network streams.

## Purpose

The majority of load balancers have numerous functions, which makes them quite difficult to use. Gorbit should only do one job, loadbalance, without too many extra features.

## Implementation

For the main implementation of the application, I used **GOs** standard library. To retrieve the configuration from the configuration file, I utilized the **Viper library**, as it effectively removes a significant amount of boilerplate code.

I tried to split up the program into 5 separate parts:

- Configuration Handler
- Traffic Handler
- Traffic Controller
- Listener
- Logger

Where the **Configuration Handler** reads the configuration from either the environment variables or a **.yaml** file. 

The **Traffic Handler** manages the redirection of the traffic, while the **Listener** opens a **TCP** listener to listen for incoming connections, it does this by using the **net** library from the **GO standard library**.

**Traffic Handler** is operating with a custom implementation of a buffered IO copy.

The **Traffic Controller** does regular checks, to make sure all targets are up and running, if a target goes down, the target is removed from the list of targets, and there will be no more redirections to this target until it is up again.

The **Logger** is basically just handling logging of events. The **Logger** operates with three distinct logging levels, named "ERROR, WARNING, and INFORMATION". The required logs can be selected through the configuration as well.

## Lessons Learned

This project taught me how to work with the **Viper** library, it is a very convenient way to handle configuration files in **GO**.

Since this is a simple project, I think the implementation went very well. I learned a lot about networking in **GO**, and also got a more profound understanding of how loadbalancing works.
