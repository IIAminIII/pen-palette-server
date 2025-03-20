const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:5173",
      "https://stunning-gumption-53af0c.netlify.app",
    ],

    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());


app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
// MongoDB Client
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ylf2c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "Access Denied" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(400).json({ message: "Invalid Token" });
    }
    req.user = decoded;
    next();
  });
};

app.get("/", (req, res) => {
  res.send("Hello World");
});


async function run() {
  try {
    // await client.connect(); 
    const database = client.db("BlogDB");
    const blogCollection = database.collection("blogs");
    const wishListCollection = database.collection("WishList");
    const commentCollection = database.collection("Comments");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .json({ success: true });
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .json({ success: true });
    });


    app.get("/allBlog", async (req, res) => {
      const { search, category } = req.query;

      const filters = {};
      if (search) filters.title = { $regex: search, $options: "i" };
      if (category) filters.category = category;

      const blogs = await blogCollection.find(filters).toArray();
      res.json(blogs);
    });
    app.get("/allBlog/:text",async(req,res)=>{
      const text = req.params.text;
      const query = {title:{$regex:text,$options:'i'}};
      const cursor = blogCollection.find(query);
      const blogs = await cursor.toArray();
      res.send(blogs);
    })

    app.get('/recentBlog',async(req,res)=>{
      const recentBlogs = await blogCollection
            .find({})
            .sort({ createdAt: -1 }) 
            .limit(6)               
            .toArray();              
        res.status(200).json(recentBlogs);
    })
    app.get("/blog/:id",async (req, res) => {
      const id = req.params.id;
      const blog = await blogCollection.findOne({ _id: new ObjectId(id) });
   
      res.json(blog);
    });

    app.post('/addBlog', verifyToken, async (req, res) => {
      const { title, image, category, shortDescription, description } = req.body;
      const userEmail = req.user.email; 
      const userName = req.user.displayName; 
      const newBlog = { title, image, category, shortDescription, description, userEmail, userName,createdAt: new Date() };
      const result = await blogCollection.insertOne(newBlog);
      res.json(result);
    });
    app.put('/updateBlog/:id',verifyToken,async(req,res)=>{
      const id = req.params.id;
      const updatedBlog = req.body;
      const query = {_id: new ObjectId(id)};
      const blog = await blogCollection.findOne(query);
      if (blog.userEmail !== req.user.email) {
        return res.status(403).json({ message: "You are not authorized to update this blog." });
      }
      const updatedDoc ={
        $set:{
          title: updatedBlog.title,
          description: updatedBlog.description,
          image: updatedBlog.image,
          category: updatedBlog.category,
          shortDescription: updatedBlog.shortDescription,
        }
      }
      const result = await blogCollection.updateOne(query,updatedDoc);
      res.send(result);
    })
   
    app.post("/addToWishlist", async (req, res) => {
      const { email, blogId } = req.body;
      const blog = await blogCollection.findOne({ _id: new ObjectId(blogId) });
      const userWishList = await wishListCollection.findOne({ email });

      if (userWishList) {
        const isExist = userWishList.wishList.some(
          (wish) => wish._id.toString() === blogId
        );
        if (isExist) {
          return res.status(409).json({ message: "Already Added" });
        } else {
          const result = await wishListCollection.updateOne(
            { email },
            { $push: { wishList: blog } }
          );
          return res.json(result);
        }
      }

      const result = await wishListCollection.insertOne({
        email,
        wishList: [blog],
      });
      res.json(result);
    });

    app.get("/wishlist/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.user.email) {
        return res.status(403).json({ message: "Access Denied" });
      }

      const userWishList = await wishListCollection.findOne({ email });
      res.json(userWishList?.wishList || []);
    });

    app.delete("/removeFromWishlist/:blogId", async (req, res) => {
      const { blogId } = req.params;
      const email = req.body.email;

      const result = await wishListCollection.updateOne(
        { email },
        { $pull: { wishList: { _id: new ObjectId(blogId) } } }
      );

      if (result.modifiedCount > 0) {
        return res.status(200).json({
          message: "Removed from wishlist.",
          deletedCount: result.modifiedCount,
        });
      }
      res.status(404).json({ message: "Blog not found in wishlist." });
    });


    app.post("/addComment", async (req, res) => {
      const { blogId, userName, userProfilePicture, userEmail, commentText } =
        req.body;

      const blog = await blogCollection.findOne({ _id: new ObjectId(blogId) });
      if (blog.userEmail === userEmail) {
        return res
          .status(403)
          .json({ message: "Authors cannot comment on their own blogs." });
      }

      const result = await commentCollection.insertOne({
        blogId,
        userName,
        userProfilePicture,
        userEmail,
        commentText,
      });
      res.json(result);
    });

    app.get("/comments/:blogId", async (req, res) => {
      const blogId = req.params.blogId;
      const comments = await commentCollection
        .find({ blogId })
        .toArray();
      res.json(comments);
    });
  } finally {
    // Uncomment for graceful shutdown if needed
    // await client.close();
  }
}

run().catch(console.dir);

