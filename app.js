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

app.get('/user/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/sign_in');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch sustainability data for the logged-in user
        const sql = "SELECT * FROM sustainability_data WHERE user_id = ? ORDER BY date DESC";
        const [result] = await connection.query(sql, [req.session.userId]);

        const userData = JSON.stringify(result);;
        // Pass the data to the EJS template
        res.render('user_dashboard', { loggedIn: true, data: userData });
    } catch (err) {
        console.error('Error fetching data:', err);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) connection.release();
    }
});

app.post('/submit_data', async (req, res) => {
    const {
        energy_consumption,
        water_usage,
        waste_production,
        transportation_distance
    } = req.body;

    // Calculate carbon emissions
    const energyEmissionFactor = 0.4; // kg CO2/kWh (natural gas)
    const waterEmissionFactor = 0.001; // kg CO2/liter
    const wasteEmissionFactor = 0.5; // kg CO2/kg (landfilled waste)
    const transportationEmissionFactor = 0.2; // kg CO2/km (car)

    const energyEmissions = energy_consumption * energyEmissionFactor;
    const waterEmissions = water_usage * waterEmissionFactor;
    const wasteEmissions = waste_production * wasteEmissionFactor;
    const transportationEmissions = transportation_distance * transportationEmissionFactor;

    const totalEmissions = energyEmissions + waterEmissions + wasteEmissions + transportationEmissions;
    const userId = req.session.userId;  // Assuming the user is logged in and their ID is stored in the session

    let connection;
    try {
        // Get a connection from the pool
        connection = await pool.getConnection();

        // Insert the user’s sustainability data into the database
        const sql = `
            INSERT INTO sustainability_data (user_id, energy_consumption, water_usage, waste_production, transportation_mode, carbon_emissions)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            userId,
            energy_consumption,
            water_usage,
            waste_production,
            transportation_distance, // Assuming this is your mode for simplicity
            totalEmissions
        ]);

        // Redirect to the dashboard to see the updated data
        res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) connection.release();
    }
});

app.listen(port || 3000, () => {
    console.log(`server started at port ${port}`);
});
