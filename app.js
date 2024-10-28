require('dotenv').config();
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const mysql = require('mysql2/promise') 
const express = require('express');
const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', './src/views');

// Database Pool Configuration
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Session configuration
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: false
}));

app.get('/',(req,res)=>{
    res.render('home',{ loggedIn: req.session.userId ? true : false });
});

app.get('/sign_in',(req,res)=>{
    res.render('sign_in');
});
app.post('/sign_in', async (req, res) => {
    const { email, password } = req.body;

    let connection;
    try {
        // Validate input
        if (!email || !password) {
            return res.status(400).send('Email and password are required.'); // Bad Request status
        }

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Query to check if the user exists
        const sql = "SELECT * FROM users WHERE email = ?";
        const [result] = await connection.query(sql, [email]);

        if (result.length > 0) {
            const user = result[0];

            // Compare the entered password with the hashed password in the database
            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                // Set session variables
                req.session.userId = user.user_id;
                req.session.role = user.role;

                // Redirect based on role
                if (user.role === 'admin') {
                    return res.redirect('/admin/dashboard');
                } else {
                    return res.redirect('/');
                }
            } else {
                return res.status(401).send('Invalid email or password.'); // Unauthorized status
            }
        } else {
            return res.status(401).send('Invalid email or password.'); // Unauthorized status
        }
    } catch (err) {
        console.error('Error executing query:', err);
        return res.status(500).send('Internal server error.'); // Server error
    } finally {
        // Release the connection back to the pool
        if (connection) connection.release();
    }
});

app.get('/sign_up',(req,res)=>{
    res.render('sign_up');
});
app.post('/sign_up', async (req, res) => {
    const { username, email, password, confirm_password } = req.body;

    // Check if passwords match
    if (password !== confirm_password) {
        return res.status(400).send('Passwords do not match.'); // Bad Request status
    }

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Get a connection from the pool
        const connection = await pool.getConnection();
        try {
            // Check if the user already exists
            const checkUserSql = 'SELECT * FROM users WHERE email = ?';
            const [existingUsers] = await connection.query(checkUserSql, [email]);

            if (existingUsers.length > 0) {
                return res.status(409).send('User already exists with this email.'); // Conflict status
            }

            // Insert new user into the database
            const sql = "INSERT INTO users (username, email, password) VALUES (?, ?, ?)";
            await connection.query(sql, [username, email, hashedPassword]);

            // Redirect to sign in page or send a success response
            return res.redirect('/sign_in'); // You could also respond with a success message
        } finally {
            // Release the connection back to the pool
            connection.release();
        }
    } catch (err) {
        console.error('Error executing query:', err);
        return res.status(500).send('Internal server error.'); // Server error
    }
});

app.get('/sign_out', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/user/profile',(req,res)=>{
    res.render('user_profile');
});
app.get('/user/setting',(req,res)=>{
    res.render('user_setting');
});

app.get('/user/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/sign_in');
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // Query to get total carbon emissions, energy, water, waste, and transportation for the logged-in user
        const summarySql = `
            SELECT 
                SUM(carbon_emissions) AS totalCarbonEmissions,
                SUM(energy_consumption) AS totalEnergyConsumed,
                SUM(water_usage) AS totalWaterUsage,
                SUM(waste_production) AS totalWasteGenerated,
                SUM(transportation_distance) AS totalTransportationDistance
            FROM sustainability_data
            WHERE user_id = ?`;
        const [summaryResults] = await connection.query(summarySql, [req.session.userId]);

        const userData = {
            totalEnergyConsumed: summaryResults[0].totalEnergyConsumed || 0,
            totalWaterUsage: summaryResults[0].totalWaterUsage || 0,
            totalWasteGenerated: summaryResults[0].totalWasteGenerated || 0,
            totalTransportationDistance: summaryResults[0].totalTransportationDistance || 0,
            totalCarbonEmissions: summaryResults[0].totalCarbonEmissions || 0,
        };

        // Query to fetch carbon emissions data by date for the chart
        const carbonEmissionsSql = `
            SELECT DATE(date) AS date, SUM(carbon_emissions) AS total_carbon_emissions
            FROM sustainability_data
            WHERE user_id = ?
            GROUP BY DATE(date)
            ORDER BY DATE(date) DESC
        `;
        const [carbonEmissionsResults] = await connection.query(carbonEmissionsSql, [req.session.userId]);

            // Query to fetch individual energy consumption entries over time
            const energySql = `
            SELECT DATE(date) AS date, energy_consumption AS energy
            FROM sustainability_data
            WHERE user_id = ?
            ORDER BY DATE(date) DESC
            `;
            const [energyResults] = await connection.query(energySql, [req.session.userId]);

            // Query to fetch individual water usage entries over time
            const waterSql = `
            SELECT DATE(date) AS date, water_usage AS water
            FROM sustainability_data
            WHERE user_id = ?
            ORDER BY DATE(date) DESC
            `;
            const [waterResults] = await connection.query(waterSql, [req.session.userId]);

            // Query to fetch individual waste production entries over time
            const wasteSql = `
            SELECT DATE(date) AS date, waste_production AS waste
            FROM sustainability_data
            WHERE user_id = ?
            ORDER BY DATE(date) DESC
            `;
            const [wasteResults] = await connection.query(wasteSql, [req.session.userId]);

            // Query to fetch individual transportation distance entries over time
            const transportationSql = `
            SELECT DATE(date) AS date, transportation_distance AS transportation
            FROM sustainability_data
            WHERE user_id = ?
            ORDER BY DATE(date) DESC
            `;
            const [transportationResults] = await connection.query(transportationSql, [req.session.userId]);


        // Process the data for the charts
        const labels = carbonEmissionsResults.map(record => record.date);
        const carbonEmissionsData = carbonEmissionsResults.map(record => record.total_carbon_emissions);

        const energyLabels = energyResults.map(entry => entry.date);
        const energyData = energyResults.map(entry => entry.energy);

        const waterLabels = waterResults.map(entry => entry.date);
        const waterData = waterResults.map(entry => entry.water);

        const wasteLabels = wasteResults.map(entry => entry.date);
        const wasteData = wasteResults.map(entry => entry.waste);

        const transportationLabels = transportationResults.map(entry => entry.date);
        const transportationData = transportationResults.map(entry => entry.transportation);

        // SQL query to select reminders for the logged-in user
        const selectRemindersQuery = `
        SELECT id, title, description, due_date, status
        FROM reminders
        WHERE user_id = ? AND due_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND CURDATE()
        ORDER BY due_date ASC
    `;
    
        const [reminders] = await connection.query(selectRemindersQuery, [req.session.userId]);


        // Render the user_dashboard EJS view, passing userData and chart data
        res.render('user_dashboard', { 
            loggedIn: true, 
            userData, 
            labels, 
            carbonEmissionsData, 
            energyLabels, energyData,
            waterLabels, waterData,
            wasteLabels, wasteData,
            transportationLabels, transportationData,
            reminders
        });

    } catch (err) {
        console.error('Error fetching data:', err);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) connection.release();
    }
});

app.post('/submit', async (req, res) => {
    // Parse the input values from the form
    let energy = parseFloat(req.body.energy) || 0;
    let water = parseFloat(req.body.water) || 0;
    let waste = parseFloat(req.body.waste) || 0;
    let transportation = parseFloat(req.body.transportation) || 0;
    let energyPrice = parseFloat(req.body.energyPrice) || 0;  // New field for energy price
    let waterPrice = parseFloat(req.body.waterPrice) || 0;    // New field for water price
    let energyDate = req.body.energyDate || null;              // New field for energy date
    let waterDate = req.body.waterDate || null;                // New field for water date
    let vehicleType = req.body.vehicleType || null;            // New field for vehicle type

    console.log('Energy:', energy);
    console.log('Water:', water);
    console.log('Waste:', waste);
    console.log('Transportation:', transportation);
    console.log('Energy Price:', energyPrice);
    console.log('Water Price:', waterPrice);
    console.log('Energy Date:', energyDate);
    console.log('Water Date:', waterDate);
    console.log('Vehicle Type:', vehicleType);

    // Ensure user is logged in and has a valid session
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    let connection;
    try {
        // Establish connection to the database
        connection = await pool.getConnection();

        // Conversion factors to calculate carbon emissions
        let energyEmission = energy * 0.233;
        let waterEmission = water * 0.001; 
        let wasteEmission = waste * 1.2;
        let transportationEmission = transportation * 0.21;

        // Calculate the total carbon emissions based on inputs
        let totalCarbonEmission = energyEmission + waterEmission + wasteEmission + transportationEmission;

        // Save the user's input and calculated carbon emissions to the database
        const saveDataQuery = `
            INSERT INTO sustainability_data 
                (user_id, energy_consumption, energy_price, energy_date, water_usage, water_price, water_date, 
                waste_production, transportation_distance, transportation_mode, carbon_emissions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Use req.session.userId to associate the data with the logged-in user
        await connection.query(saveDataQuery, [
            req.session.userId,
            energy,
            energyPrice,
            energyDate,
            water,
            waterPrice,
            waterDate,
            waste,
            transportation,
            vehicleType,
            totalCarbonEmission
        ]);

        // Return the calculated carbon emissions as JSON to be used in the front-end
        res.json({ carbonEmission: totalCarbonEmission });

    } catch (err) {
        // Log and return error in case of failure
        console.error('Error while processing data:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        // Release the database connection
        if (connection) connection.release();
    }
});

// route for user reminder form get and post 
app.get('/user/reminder',(req,res)=>{
    res.render('user_reminder');
});
app.post('/user/reminder', async (req, res) => {
    // Parse the input values from the form
    const { title, description, reminderDate } = req.body;

    // Ensure user is logged in and has a valid session
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    let connection;
    try {
        // Establish connection to the database
        connection = await pool.getConnection();

        // SQL query to insert the reminder into the reminders table
        const insertReminderQuery = `
            INSERT INTO reminders (user_id, title, description, due_date)
            VALUES (?, ?, ?, ?)
        `;

        // Use req.session.userId to associate the reminder with the logged-in user
        await connection.query(insertReminderQuery, [
            req.session.userId,
            title,
            description,
            reminderDate
        ]);

        // Send success response
        res.redirect('/user/dashboard')

    } catch (err) {
        // Log and return error in case of failure
        console.error('Error while creating reminder:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        // Release the database connection
        if (connection) connection.release();
    }
});
// Mark reminder as complete
app.post('/user/reminder/complete', async (req, res) => {
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    const reminderId = req.body.reminderId;

    let connection;
    try {
        connection = await pool.getConnection();
        
        // SQL query to mark the reminder as complete
        const completeQuery = `
            UPDATE reminders
            SET status = 'completed' 
            WHERE id = ? AND user_id = ?`
        ;
        
        await connection.query(completeQuery, [reminderId, req.session.userId]);

        // Redirect back to the reminders page
        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Error while completing reminder:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (connection) connection.release();
    }
});


// Cancel reminder
app.post('/user/reminder/cancel', async (req, res) => {
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    const reminderId = req.body.reminderId;

    let connection;
    try {
        connection = await pool.getConnection();
        
        // SQL query to delete the reminder
        const cancelQuery = `
            DELETE FROM reminders
            WHERE id = ? AND user_id = ?
        `;
        
        await connection.query(cancelQuery, [reminderId, req.session.userId]);

        // Redirect back to the reminders page
        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Error while canceling reminder:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (connection) connection.release();
    }
});


// Get all articles for the community page
app.get('/community', async (req, res) => {
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        
        // SQL query to fetch articles with the user who created them
        const fetchArticlesQuery = `
            SELECT a.id, a.title, a.content, a.created_at, u.username 
            FROM articles a 
            JOIN users u ON a.user_id = u.user_id
            ORDER BY a.created_at DESC
        `;
        
        const [articles] = await connection.query(fetchArticlesQuery);

        // Render the community page with the articles data
        res.render('community', { articles });
    } catch (err) {
        console.error('Error while fetching articles:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/community/article',(req,res)=>{
    res.render('article_form');
});
// Assuming you have Express set up and connected to your MySQL database
app.post('/community/article', async (req, res) => {
    if (!req.session.userId) {
        return res.status(400).json({ error: "User not logged in" });
    }

    const { title, content } = req.body;
    const userId = req.session.userId; // Assuming you have user ID in session

    let connection;
    try {
        connection = await pool.getConnection();
        
        // SQL query to insert the new article
        const insertArticleQuery = `
            INSERT INTO articles (title, content, user_id, created_at)
            VALUES (?, ?, ?, NOW())
        `;
        
        await connection.query(insertArticleQuery, [title, content, userId]);

        // Redirect back to the community page
        res.redirect('/community');
    } catch (err) {
        console.error('Error while submitting article:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (connection) connection.release();
    }
});


app.listen(port || 3000, () => {
    console.log(`server started at port ${port}`);
});