import express, { query } from "express";
import path from "path";
import otpGenerator from "otp-generator";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import session from "express-session";
import 'dotenv/config';
import fs from 'fs';
import pkg from "pg";
import twilio from "twilio";
import cors from "cors";
import multer from 'multer';
import axios from 'axios';
import FormData from "form-data";
const { Pool } = pkg;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.set("view engine", "ejs");

// const upload = multer({dest:'uploads/'});
const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASS,
        port: process.env.DB_PORT,
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
});
// app.use(session({
//     secret: process.env.SECERT_KEY,
//     resave: false,
//     saveUninitialized: true
// }));
// dotenv.config();
console.log("DB_USER:", process.env.DB_USER);  
console.log("DB_PASS:", process.env.DB_PASS);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "lagunagepage.html"));
});

app.post("/official", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "officerlogin.html"));
});
app.post("/citizensignupG",(req,res)=>{
    res.sendFile(path.join(__dirname,"public",'citizensignupG.html'));
});
app.post("/signup1", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "signup.html"));
});
app.post("/citizenloginG",(req,res)=>{
    res.sendFile(path.join(__dirname,"public",'citizenloginG.html'));
});
app.post("/login1", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

var Email = "";
var citizenEmail="";
app.post("/get-otp", async (req, res) => {
    const { officialname, email, phonenumber, pincode, post, password } = req.body;

    if (!officialname || !email || !phonenumber || !pincode || !post || !password) {
        console.log("Missing required fields");
        return res.status(400).json({ error: "All fields are required" });
    }

    try {
        await pool.query(
            'INSERT INTO verifyofficals (officialname, email, phonenumber, pincode, post, passwordoff) VALUES ($1, $2, $3, $4, $5, $6)',
            [officialname, email, phonenumber, pincode, post, password]
        );

        Email = email;
        console.log(`User ${email} registered successfully`);

        const otp = otpGenerator.generate(6, { digits: true });
        console.log(`Generated OTP for ${email}: ${otp}`);

        try {
            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: "ohmpatel655@gmail.com",
                    pass: process.env.GG_PASS, 
                },
            });

            const mailOptions = {
                from: "ohmpatel655@gmail.com",
                to: email,
                subject: "Verification",
                text: `Your OTP is: ${otp}`,
            };

            await transporter.sendMail(mailOptions);
            console.log(`OTP sent to ${email}`);
        } catch (error) {
            console.error("Error sending OTP:", error);
            return res.status(500).json({ error: "Error sending OTP." });
        }

        const expiryTime = new Date(Date.now() + 5 * 60 * 1000);
        await pool.query('UPDATE verifyofficals SET otp = $1, expiryTime = $2 WHERE email = $3', [otp, expiryTime, email]);
        console.log(`OTP stored in DB for ${email}, expires at ${expiryTime}`);
        res.sendFile(path.join(__dirname, "public", "otp.html"));

    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: "Database error" });
    }
});
const accountSid = process.env.OHMB;
const authToken = process.env.OHMA;
const client = new twilio(accountSid, authToken);
app.post('/update-status', async (req, res) => {
    const { mobilenum, complaintdesc, status, department } = req.body;
    console.log(mobilenum);
    console.log("Received Data:", { mobilenum, complaintdesc, status, department });

    const department1 = department.toLowerCase().replace(/\s+/g, '_'); // Format table name
    console.log("Formatted Department Table Name:", department1);

    const client = await pool.connect(); // Start transaction

    try {
        await client.query("BEGIN"); // Start transaction

        // Check if complaint exists
        const checkComplaint = await client.query(
            `SELECT * FROM complaint WHERE mobilenum = $1 AND complaint = $2`,
            [mobilenum, complaintdesc]
        );

        console.log("Database Query Result:", checkComplaint.rows);

        if (checkComplaint.rowCount === 0) {
            await client.query("ROLLBACK"); // Rollback transaction
            return res.status(404).json({ 
                message: "Complaint not found", 
                received: { mobilenum, complaintdesc } 
            });
        }

        // Update department table
        const updateDept = await client.query(
            `UPDATE ${department1} SET status = $1 WHERE mobilenum = $2 AND complaintdesc = $3 RETURNING *`,
            [status, mobilenum, complaintdesc]
        );

        if (updateDept.rowCount === 0) {
            throw new Error(`No matching record in ${department1} table!`);
        }

        // Update main complaint table
        const updateComplaint = await client.query(
            `UPDATE complaint SET dstatus = $1 WHERE mobilenum = $2 AND complaint = $3 RETURNING *`,
            [status, mobilenum, complaintdesc]
        );

        // Update taluka table
        const updateTaluka = await client.query(
            `UPDATE ${checkComplaint.rows[0].taluka} SET status = $1 WHERE complaintdesc = $2 AND mobilenum = $3 RETURNING *`,
            [status, complaintdesc, mobilenum]
        );

        // Update global status table
        const updateStatus = await client.query(
            `UPDATE status SET status=$1 WHERE mobilenumber=$2 AND complainttype=$3 RETURNING *`,
            [status, mobilenum, complaintdesc]
        );

        await client.query("COMMIT"); // Commit transaction

        res.json({ 
            message: "Status updated successfully!", 
            updatedComplaint: updateComplaint.rows[0],
            departmentUpdate: updateDept.rows[0],
            talukaUpdate: updateTaluka.rows[0],
            statusUpdate: updateStatus.rows[0]
        });

    } catch (error) {
        await client.query("ROLLBACK"); // Rollback transaction on error
        console.error("Database error:", error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    } finally {
        client.release(); // Release client
    }
});

app.get("/omcitizen", async (req, res) => {
    try {
        let mobile = req.query.mobile.trim(); // Remove spaces

        // Ensure mobile number has "+"
        if (!mobile.startsWith("+")) {
            mobile = `+${mobile}`;
        }

        console.log("Formatted mobile number:", mobile);

        const result = await pool.query(
            "SELECT * FROM complaint WHERE mobilenum = $1",
            [ mobile]
        );

        console.log("Query result:", result.rows);

        res.json(result.rows);
    } catch (error) {
        console.error("Database query error:", error);
        res.status(500).json({ error: "Database query failed" });
    }
});



app.get("/plot-graphs", async (req, res) => {
    try {
      const result = await pool.query('SELECT status FROM ahwa');
      let pending = 0;
      let resolved = 0;
      result.rows.forEach(row => {
        if (row.status === "Resolved") {
            resolved++;
        } else {
            pending++;
        }
    });

    res.json({ resolved, pending });
    } catch (error) {
      console.error("Error fetching data:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
var postom = "";
app.post("/loginoff",async(req,res)=>{
    // const otp = otpGenerator.generate(6,{text:true});
    const {mobile,password}=req.body;
    // try {
    //     const response = await client.messages.create({
    //         body:`Verification ${otp}`,
    //         from: process.env.OHM_NUMBER,
    //         to:mobile
    //     });
    //     } catch (error) {
    //         res.status(500).json({ success: false, error: error.message });
    //     }
        const result = await pool.query('SELECT post FROM verifyofficals WHERE phonenumber=$1', [mobile]);
        // console.log(result.rows[0].post); 
        if(result.rows[0].post=='Opreator')
        {
            res.sendFile(path.join(__dirname,"public","opreatordashboard.html"));
        }
        else if(result.rows[0].post=='mamlatdar-ahwa')
        {
            req.session.mamlatdar={
                post:"mamlatdar-ahwa"
            }
            res.sendFile(path.join(__dirname,"public","mamlatdar.html"));
        }
        else if(result.rows[0].post=='mamlatdar-subir')
        {
            req.session.mamlatdar={
                post:"mamlatdar-subir"
            }
            res.sendFile(path.join(__dirname,"public","mamlatdar.html")); 
        }
        else if(result.rows[0].post=='mamlatdar-waghai')
        {
            req.session.mamlatdar={
                post:"mamlatdar-waghai"
            }
            res.sendFile(path.join(__dirname,"public","mamlatdar.html"));      
        }
        else if(result.rows[0].post=="Collector")
        {
            res.sendFile(path.join(__dirname,"public","admin.html"));
        }
        else if(result.rows[0].post=='SDM')
        {
            res.sendFile(path.join(__dirname,"public","sdm.html"));
        }
        else if(result.rows[0].post=='Collector')
        {
            res.sendFile(path.join(__dirname,"public","admin.html"));
        }
        else if(result.rows[0].post=='grampanchayat')
        {
            const result = await pool.query('SELECT village FROM verifyofficals WHERE phonenumber = $1',[phonenumber]);
            const village = result.rows[0].village;
            req.session.grampanchayat={
                post:village
            }
        }
        else if(result.rows[0].post=='Talati')
        {
            // await pool.query()
            req.session.talati={
                // village:"";
            }
        }
        else
        {
            // const departmentResult = await pool.query(`SELECT complaintdesc, complaintdep, taluka, mobilenum FROM "${result.rows[0].post}"`);
            // // res.render("department.ejs", { complaint: departmentResult.rows });
            // // res.sendFile(path.join(__dirname,"public","de.html"));
            postom = result.rows[0].post;
            res.sendFile(path.join(__dirname, "public", "de.html"));

        }
});
app.get('/api/complaints', async (req, res) => {
    try {
        const department = postom;  // Ensure `postom` is correctly assigned
        console.log('Department:', department);

        const departmentResult = await pool.query(
            `SELECT problemdesc, complaintdep, taluka, mobilenum, status, complaintid, village, image_url, image_url_proof 
            FROM "${department}" WHERE status = $1`, 
            ['Assigned']
        );

        if (departmentResult.rows.length === 0) {
            return res.json({ complaints: [], department: department });  // Always send department name
        }

        res.json({ complaints: departmentResult.rows, department: department });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});


  app.get('/api/complaints/admin/:status', async (req, res) => {
    try {
        const { status } = req.params;
        const result = await pool.query(
            "SELECT * FROM complaint WHERE ostatus = $1",
            [status]
        );

        res.json({ complaints: result.rows });
    } catch (error) {
        console.error("Error fetching SDM complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
app.get('/api/complaints/gmp/:status', async (req, res) => {
    try {
        const { status } = req.params;
        const result = await pool.query(
            "SELECT * FROM complaint WHERE ostatus = $1 AND WHERE village = $2",
            [status,village]
        );

        res.json({ complaints: result.rows });
    } catch (error) {
        console.error("Error fetching SDM complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
app.get('/api/complaints/sdm/:status', async (req, res) => {
    try {
        const { status } = req.params;
        const result = await pool.query(
            "SELECT * FROM complaint WHERE ostatus = $1",
            [status]
        );

        res.json({ complaints: result.rows });
    } catch (error) {
        console.error("Error fetching SDM complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
  app.get('/api/complaints/taluka/:status', async (req, res) => {
    try {
        if (!req.session.mamlatdar || !req.session.mamlatdar.post) {
            return res.status(401).json({ error: "Unauthorized: Mamlatdar not logged in" });
        }

        const { status } = req.params;
        let tableName = "";
        if (req.session.mamlatdar.post === "mamlatdar-ahwa") {
            tableName = "ahwa";
        } else if (req.session.mamlatdar.post === "mamlatdar-subir") {
            tableName = "subir";
        } else if (req.session.mamlatdar.post === "mamlatdar-waghai") {
            tableName = "waghai";
        }
        else {
            return res.status(400).json({ error: "Invalid Mamlatdar post" });
        }
        const result = await pool.query(`SELECT * FROM ${tableName} WHERE status = $1`, [status]);

        res.json({ complaints: result.rows });
    } catch (error) {
        console.error("Error fetching complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post("/citizen",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","citizenlogin.html"));
});
app.post("/citizensignup",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","citizen.html"));
});
app.post("/citizenlogin",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","citizenlogin.html"));
});
// const upload = multer({ dest: 'uploads/' });app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Configure Multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, "uploads/images/");
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            // Get mobile number first, then timestamp
            const mobile = req.body.mobile || 'unknown';
            const fileName = `${mobile}-${Date.now()}-${file.originalname.replace(/\s/g, '_')}`;
            cb(null, fileName);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed!"), false);
        }
    }
});
// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

// Complaint Submission API
app.post("/uploadsom", upload.single("image"), async (req, res) => {
    try {
        const { mobile, complaintCategory, complaintType, problemDesc, taluka, name, villageCity } = req.body;
        const imagePath = req.file ? req.file.path.replace(/\\/g, '/') : null;
        const complaintid = `${mobile}-${Date.now()}`;
        console.log("✔ Received Complaint Data:", { 
            mobile, 
            complaintCategory, 
            complaintType, 
            problemDesc, 
            taluka, 
            name, 
            villageCity, 
            imagePath 
        });
        if (!mobile || !complaintCategory || !complaintType || !problemDesc || !taluka || !name || !villageCity) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const updateResult = await pool.query(
            `UPDATE citizenverify 
             SET complaintdesc = $1, complaintcategory = $2, complainttype = $3, imagepath = $4 
             WHERE phonenumber = $5 
             RETURNING *`,
            [problemDesc, complaintCategory, complaintType, imagePath, mobile]
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: "No citizen found with this phone number" });
        }
        await pool.query(
            `INSERT INTO complaint (complaint, department, taluka, mobilenum, nameofcitizen, village, complaintdesc, image_url,ostatus,complaintid) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10) `,
            [complaintType, complaintCategory, taluka, mobile, name, villageCity, problemDesc, imagePath,'Logged',complaintid]
        );
        const status = "Logged";
        await pool.query(
            `INSERT INTO status (complaint, status, mobilenumber, taluka,complainttype,complaintcategory) 
             VALUES ($1, $2, $3, $4 ,$5 ,$6)`,
            [problemDesc, status, mobile, taluka,complaintType,complaintCategory]
        );
        await pool.query(`INSERT INTO ${taluka} (complaintdep,complaintdesc,mobilenum,complaintcategory,status,image_url)
            VALUES ($1,$2,$3,$4,$5,$6)`,[complaintCategory,problemDesc,mobile,complaintType,'Logged',imagePath])
        res.json({ 
            success: true, 
            message: "Complaint submitted successfully", 
            imagePath,
            data: { 
                mobile, 
                complaintCategory, 
                complaintType, 
                taluka,
                name,
                villageCity,
                problemDesc
            }
        });
    } catch (err) {
        console.error("❌ Error Handling Complaint:", err);
        res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    
    console.error(err.stack);
    res.status(500).json({ error: err.message || 'Something went wrong!' });
});
app.post("/omlogin", async (req, res) => {
    const { mobile , pass } = req.body;

    try {
        const { rows } = await pool.query('SELECT passwordofcitizen FROM citizenverify WHERE phonenumber = $1', [mobile]);

        if (rows.length === 0) {
            return res.status(400).json({ error: "Invalid Mobilenumber" });
        }

        const { passwordofcitizen } = rows[0];

        if (pass != passwordofcitizen) {
            return res.status(400).json({ error: "Invalid Password" });
        }

        res.sendFile(path.join(__dirname, "public", "citizendashboard.html"));
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
app.post("/signup",async(req,res)=>{
    const  otp1= otpGenerator.generate(6,{text:true});
    const {name,phonenumber,email,taluka,district,place,password}=req.body;
    const expiryTime=new Date(Date.now()+5*60*1000);
    citizenEmail=email;
    await pool.query('INSERT INTO citizenverify (nameofcitizen,phonenumber,email,taluka,district,place,passwordofcitizen,otp,expirytime) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[name,phonenumber,email,taluka,district,place,password,otp1,expiryTime]);
    try{
        const transporter = nodemailer.createTransport({
            service:'gmail',
            auth: {
                user: "ohmpatel655@gmail.com",
                pass: process.env.GG_PASS, 
            },
        })
        const mailOptions = {
            from:'ohmpatel655@gmail.com',
            to:email,
            subject:'Verification',
            text:`Your OTP is ${otp1}`
        }
        await transporter.sendMail(mailOptions);
        res.sendFile(path.join(__dirname,"public","otp.html"));
    }
    catch(error){
        console.error("Error sending OTP:", error);
        return res.status(500).json({ error: "Error sending OTP." });
    }
});
app.get("/complaintcard", async (req, res) => {
    try {
        const ostatus1 = "Logged";
        const result = await pool.query(
            'SELECT  department, taluka, complaintdesc, ostatus, complaintid,village, image_url, image_url_proof,proloc FROM complaint WHERE ostatus = $1',
            [ostatus1]
        );
        const complaints = result.rows;

        let logged = 0;
        complaints.forEach(complaint => {
            if (complaint.ostatus === "Logged") {
                logged++;
            }
        });

        console.log(logged);
        res.json({ complaints, logged });
    } catch (error) {
        console.error("Error fetching complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

  
  app.use(express.static("public"));
  

app.post("/redirect",(req,res)=>{
    // res.sendFile(path.join(__dirname,"public","deapartment.html"));
    res.status(200).json({ message: "Redirect successful" });
});
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const mobile = req.body.mobilenum || 'unknown'; // Get mobile from request body
        const ext = path.extname(file.originalname);
        cb(null, `${mobile}-${Date.now()}-proof${ext}`);
    }
});
app.use(express.json());
app.post('/upload-proof', upload.single('proof'), async(req, res) => {
    try {
        const { mobilenum, complaintdesc, complaintdep,taluka} = req.body;
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        let department = complaintdep.toLowerCase().replace(/\s+/g, '_');
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        console.log('Uploaded file URL:', fileUrl);
        res.json({
            message: 'Proof uploaded successfully',
            fileUrl,
            mobilenum,
            complaintdesc
        });
        await pool.query('UPDATE complaint SET dstatus = $1, image_url_proof = $2 WHERE mobilenum = $3 AND complaintdesc = $4',['Resolved', fileUrl, mobilenum, complaintdesc]);
        await pool.query(`UPDATE ${taluka} SET status = $1,image_url_proof=$2 WHERE mobilenum = $3 AND complaintdesc = $4`,['Resolved',fileUrl,mobilenum,complaintdesc]);
        await pool.query(`UPDATE ${department} SET status = $1, image_url_proof = $2 WHERE mobilenum = $3 AND complaintdesc = $4`, ['Resolved', fileUrl, mobilenum, complaintdesc]
);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post("/citizenverify",async(req,res)=>{
    const {otptemp}=req.body;
    const {otp,expiryTime}=await pool.query('SELECT otp,expirytime FROM citizenverify WHERE email=$1',[citizenEmail]);
    const currentTime=Date.now();
    try{
    if(String(otptemp).trim() !== String(otp).trim())
    {
        console.log('Invalid OTP');
        return res.sendStatus(400).json({error:"Invalid Email"});
        await pool.query('DELETE FROM citizenverify WHERE email = $1', [Email]);
    }
    else if(currentTime>expiryTime)
    {
        console.log('Time limit expired');
        return res.sendStatus(400).json({error:"Time limit expired"});
        await pool.query('DELETE FROM citizenverify WHERE email = $1', [Email]);
    }
    // return res.json({message:'Done'});
    res.sendFile(path.join(__dirname,"public","citizendashboard.html"));
}
catch(error)
{
    return res.sendStatus(400).json({error:"Internal server error"});
}
});
app.use(express.json()); 
app.post("/res", async (req, res) => {
    const { options, complaintInfo } = req.body;
    const optionsString = options.join(',');
    if (!Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ error: "Invalid or missing 'options' array." });
    }
    if (!complaintInfo || typeof complaintInfo !== 'object') {
      return res.status(400).json({ error: "Invalid or missing 'complaintInfo' object." });
    }
  
    try {
      for (const option of options) {
        const tableName = option.replace(/\s+/g, '_').toLowerCase();
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS "${tableName}" (
            id SERIAL PRIMARY KEY,
            complaintdesc VARCHAR(250),
            complaintdep VARCHAR(250),
            problemdesc VARCHAR(500),
            taluka VARCHAR(250),
            mobilenum VARCHAR(15),
            status VARCHAR(50),
            image_url_proof VARCHAR(250)
          )
        `;
        await pool.query(createTableSQL);
        const insertDataSQL = `
          INSERT INTO "${tableName}" (complaintdesc, complaintdep, taluka, mobilenum,problemdesc,status)
          VALUES ($1, $2, $3, $4,$5,$6)
        `;
        await pool.query(`INSERT INTO ${complaintInfo.talukaS} (complaintdep,complaintdesc,mobilenum,taluka,complaintcategory,status) VALUES ($1,$2,$3,$4,$5,$6)`,[optionsString,complaintInfo.problemS,complaintInfo.mobilenumS,complaintInfo.talukaS,complaintInfo.complaintS,'Assigned']);
        await pool.query(insertDataSQL, [
          complaintInfo.complaintS,
          optionsString,
          complaintInfo.talukaS,
          complaintInfo.mobilenumS,
          complaintInfo.problemS,
          'Assigned'
        ]);
        await pool.query('UPDATE complaint SET ostatus=$1,department =$2 WHERE mobilenum = $3 AND complaintdesc = $4',['Assigned',optionsString,complaintInfo.mobilenumS,complaintInfo.problemS]);
        await pool.query('UPDATE status SET status = $1 WHERE mobilenumber = $2 AND complaint = $3',['Assigned',complaintInfo.mobilenumS,complaintInfo.problemS]);
        await pool.query(`UPDATE ${complaintInfo.talukaS} SET status = $1 WHERE mobilenum = $2 AND complaintdesc = $3`,['Assigned',complaintInfo.mobilenumS,complaintInfo.problemS]);
      }
  
      res.json({ message: "Tables created and data inserted successfully." });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "An error occurred while processing your request." });
    }
    // const status = 'Assigned'
    // await pool.query('UPDATE status SET status = $1 WHERE mobilenumber = $2',[status,mobilenum]);
  });

app.post("/verify", async (req, res) => {
    try {
        const currentTime = Date.now();
        console.log(`Verifying OTP for ${Email} at ${new Date(currentTime)}`);
        const result = await pool.query('SELECT otp, expiryTime FROM verifyofficals WHERE email = $1',[Email]);

        if (result.rows.length === 0) {
            console.log(`No OTP found for ${Email}`);
            return res.status(400).json({ error: "Invalid email" });
        }

        const { otp , expiryTime } = result.rows[0];
        const { OTP } = req.body;
        if(OTP=="NULL" && currentTime > expiryTime)
        {
            await pool.query('DELETE FROM verifyofficals WHERE email = $1', [Email]);
            return res.status(400).json({error:"verify it"});
        }

        if (String(otp).trim() !== String(OTP).trim()) {
            console.log(`Incorrect OTP for ${Email}. Deleting record.`);
            await pool.query('DELETE FROM verifyofficals WHERE email = $1', [Email]);
            return res.status(400).json({ error: "Invalid OTP" });
        }

        if (currentTime > new Date(expiryTime)) {
            console.log(`OTP expired for ${Email}. Deleting record.`);
            await pool.query('DELETE FROM verifyofficals WHERE email = $1', [Email]);
            return res.status(400).json({ error: "OTP expired" });
        }

        console.log(`OTP verification successful for ${Email}`);
        res.json({ message: "OTP verified successfully!" });

    } catch (error) {
        console.error("Error verifying OTP:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
app.post("/dc",async(req,res)=>{
    const ostatus = 'Declined';
    const complaints = await pool.query('SELECT complaint,department,taluka,mobilenum,complaintdesc,image_url FROM complaint WHERE ostatus = $1',[ostatus]);
    res.json(complaints.rows);
});
app.post("/r",async(req,res)=>{
    // const ostatus = '';
    const complaints = await pool.query('SELECT complaint,department,taluka,mobilenum,complaintdesc,image_url FROM complaint',);
    res.json(complaints.rows);
});
app.post("/rc",async(req,res)=>{
    const ostatus = 'Assigned';
    const complaints = await pool.query('SELECT complaint,department,taluka,mobilenum,complaintdesc,image_url FROM complaint WHERE ostatus = $1',[ostatus]);
    res.json(complaints.rows);
});
app.get('/api/complaints/on-hold/:department', async (req, res) => {
    let department = req.params.department.toLowerCase().replace(/\s+/g, '_');
    
    console.log("Requested Department:", department);

    try {
        const result = await pool.query(
            `SELECT * FROM "${department}" WHERE status = $1`, 
            ['On Hold']
        );

        console.log("Query Result:", result.rows);  

        res.json({ complaints: result.rows });

    } catch (error) {
        console.error("Error fetching complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/api/complaints/resolved/:department', async (req, res) => {
    let department = req.params.department.toLowerCase().replace(/\s+/g, '_');
    try {
        const result = await pool.query(
            `SELECT * FROM "${department}" WHERE status = $1`, 
            ['Resolved']
        );
        res.json({ complaints: result.rows });
    } catch (error) {
        console.error("Error fetching complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
app.get('/api/complaints/under-resolution/:department', async (req, res) => {
    const { department } = req.params;
    var department1 = department.toLowerCase().replace(/\s+/g, '_');

    try {
        const result = await pool.query(
            `SELECT * FROM "${department1}" WHERE status = $1`,
            ['Under Resolution']
        );

        res.json({ complaints: result.rows });
    } catch (error) {
        console.error('Error fetching under resolution complaints:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
const ELEVENLABS_API_KEY = process.env.OHMS;
const storage1 = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/audio/'); // Ensure this folder exists
    },
    filename: (req, file, cb) => {
        cb(null, `audio-${Date.now()}.wav`); // Save as .wav file
    }
});

const audioUpload = multer({
    storage: storage1, // Use the correct variable name
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('audio/')) {
            return cb(new Error('Only audio files are allowed!'), false);
        }
        cb(null, true);
    }
});

// POST endpoint for audio upload
app.post('/uploadvoice', audioUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No audio file uploaded!');
        }

        console.log("File received:", req.file.path); // Debugging

        // Transcribe the uploaded audio using ElevenLabs API
        const transcript = await transcribeWithElevenLabs(req.file.path);
        console.log("Transcription:", transcript);

        // Process the Gujarati transcript using Gemini API for translation
        const translatedText = await processGujaratiText(transcript);
        console.log("Translated Text:", translatedText);

        res.json({ 
            message: "Audio uploaded and processed successfully!", 
            filePath: req.file.path,
            transcript,
            translatedText 
        });

    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Function to transcribe audio using ElevenLabs API
async function transcribeWithElevenLabs(audioFilePath) {
    const url = "https://api.elevenlabs.io/v1/speech-to-text"; // Verify this is the correct endpoint
    const formData = new FormData();

    if (!fs.existsSync(audioFilePath)) {
        throw new Error("Audio file not found: " + audioFilePath);
    }

    formData.append('file', fs.createReadStream(audioFilePath), {
        filename: 'audio.wav',
        contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1'); // Ensure the model exists
    formData.append('model_id', 'scribe_v1');
    formData.append('language', 'en'); // Optionally add language parameter

    try {
        const response = await axios.post(url, formData, {
            headers: {
                "xi-api-key": ELEVENLABS_API_KEY,
                ...formData.getHeaders()
            }
        });

        console.log("ElevenLabs Full API Response:", response);
        console.log("ElevenLabs Response Data:", response.data);

        if (!response.data || !response.data.text) {
            throw new Error("No transcription text found in API response.");
        }

        return response.data.text;
    } catch (error) {
        console.error("ElevenLabs API error:", error.response ? error.response.data : error.message);
        throw new Error("Speech-to-text conversion failed.");
    }
}

// Function to process Gujarati transcript using Gemini APIasync
async function processGujaratiText(transcript) {
    const apikey = process.env.OHMG;
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro-001:generateContent?key=${apikey}`;

    console.log("[DEBUG] Attempting translation for:", transcript);

    const requestBody = {
        contents: [{
            parts: [{
                text: `Translate this text to English: "${transcript}"`
            }]
        }]
    };

    try {
        console.log("[DEBUG] Sending request to Gemini API...");
        const response = await axios.post(url, requestBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 100000 // 10 seconds timeout
        });

        console.log("[DEBUG] Full Gemini API Response:", JSON.stringify(response.data, null, 2));

        const output = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!output) {
            throw new Error("Empty response from Gemini API");
        }

        return output;
    } catch (error) {
        console.error("[ERROR] Gemini API Failure:", {
            message: error.message,
            response: error.response?.data,
            code: error.code
        });
        throw new Error("Gemini service unavailable");
    }
}
app.get("/api/complaints/admin", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM complaint');
        res.json(result.rows); 
    } catch (error) {
        console.error("Error fetching complaints:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
const PORT1 = process.env.PORT || 3000;
app.listen(PORT1, () => {
    console.log(`Server running on http://localhost:${PORT1}`);
});