DynamoDB is too good to be monopolized by AWS 🃏

## Purpose

As president of the official DynamoDB fan cult, I could brag about the **single table** database design for hours... 

*But what is the single table design?*

A model design for databases that use a composed partition key. To make it work, the **primary key** contains the following information:
```svelte
<ENTITY_TYPE>#<ENTITY_ID>
```
To model one to many connections, the system uses a **secondary key** (in DynamoDB called *sortkey*).

The final partition key is composed of those two keys like this:

- `<ENTITY_TYPE>#<ENTITY_ID>` & `<RELATION_TYPE>#<RELATION_ID>`

Example:

- `ORDER#1234` & `ITEM#1`
- `ORDER#1234` & `ITEM#2`


The idea of DynamiteDB is to implement such a system on top of S3, which makes it versatile and self-hostable.


## Implementation

If you think about the **single table** design for a minute, you'll notice that this can also be represented as a **hive-style** path:

```svelte
/<ENTITIY_TYPE>/<ENTITY_ID>/<RELATION_TYPE>/<RELATION_ID>
```

DynamiteDB exploits this fact by writing data, CBOR-encoded, directly to S3 paths.


Besides this simple storage layer DynamiteDB also implements a pretty uncommon SDK interface.

The interface is based on the idea that you define your schema models as typesafe Go structs and then use them to create, update, delete, ... items.

Example:

```go
type OrderItem struct {
    OrderId     dynamitedb.KeyField             `pk:"order" cbor:"-"`
    ItemId      dynamitedb.KeyField             `sk:"item" cbor:"-"`
    Name        dynamitedb.DataField[string]    `cbor:"name,omitempty"`
    Count       dynamitedb.DataField[int]       `cbor:"count,omitempty"`
    Price       dynamitedb.DataField[int]       `cbor:"price,omitempty"`
}

dynamitedb.Create(context.TODO(), bucket, &OrderItem{
    OrderId:    dynamitedb.Key("1"),
    ItemId:     dynamitedb.Key("3"),
    Name:       dynamitedb.Set("CNC Machine"),
    Count:      dynamitedb.Set(1),
    Price:      dynamitedb.Set(10_000),
})

dynamitedb.Update(context.TODO(), bucket, &OrderItem{
    OrderId: dynamitedb.Key("1"),
    ItemId:  dynamitedb.Key("3"),
    Count:   dynamitedb.Multiply(2),
    Price:   dynamitedb.Increment(1_000),
})

item, err := dynamitedb.Get(context.TODO(), bucket, &OrderItem{
    OrderId:    dynamitedb.Key("1"),
    ItemId:     dynamitedb.Key("3"),
    Price:      dynamitedb.GreaterThan(1337),
})
```

As you can see, the fields are defined as `dynamitedb.DataField` which is an interface that can be used to provide filter, create, and update operations without redefining the model structure.

## Lessons Learned

With DynamiteDB I chose an uncommon design approach for a Go SDK. Instead of using dynamic strings like most go-style database drivers, it uses some internal magic tricks to ensure full typesafety.

Implementation also made me aware of what exactly the **single table** design is and that it is actually pretty simple to shift to other systems.

After all, I can say that DynamiteDB is one of the most useful projects I ever created; it was a breeze to implement the CloudJam (another project) CRUD API with this beast 🔥 
