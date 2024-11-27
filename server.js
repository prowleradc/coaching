require('dotenv').config(); // Load environment variables
const express = require('express');
const stripe = require('stripe')(
    process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_LIVE_SECRET_KEY
        : process.env.STRIPE_TEST_SECRET_KEY
);
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

// Validate environment variables
if (!process.env.STRIPE_TEST_SECRET_KEY && !process.env.STRIPE_LIVE_SECRET_KEY) {
    console.error('Stripe API keys are missing. Please check your .env file.');
    process.exit(1);
}

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('SMTP credentials are missing. Please check your .env file.');
    process.exit(1);
}

// Configure CORS
const allowedOrigins = ['https://prowleradc.github.io']; // Replace with your frontend URL

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`Blocked by CORS: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    }
}));

app.use(express.json());

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the Coaching Application API!');
});

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: false, // Use TLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Function to send confirmation email
const sendConfirmationEmail = async (formData) => {
    const { email, ign, discord, coachingOption, amount } = formData;

    const emailBody = `
        <h1>Coaching Session Confirmation</h1>
        <p>Thank you for booking a coaching session with me!</p>
        <h3>Details:</h3>
        <ul>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>IGN:</strong> ${ign}</li>
            <li><strong>Discord:</strong> ${discord}</li>
            <li><strong>Coaching Option:</strong> ${coachingOption}</li>
            <li><strong>Amount Paid:</strong> $${(amount / 100).toFixed(2)} AUD</li>
        </ul>
        <p>I look forward to helping you improve. If you have any questions, feel free to reach out!</p>
    `;

    try {
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: `${email}, prowleradc@gmail.com`,
            subject: 'Coaching Session Confirmation',
            html: emailBody
        };

        await transporter.sendMail(mailOptions);
        console.log('Confirmation email sent to:', email);
    } catch (error) {
        console.error('Error sending email:', error.message);
    }
};

// Create Checkout Session route
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { email, ign, discord, coachingOption, amount } = req.body;

        // Validate inputs
        if (!email || !ign || !discord || !coachingOption || !amount) {
            console.error('Validation error:', { email, ign, discord, coachingOption, amount });
            return res.status(400).json({ error: 'All fields are required.' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.error('Invalid email:', email);
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        // Validate coaching option and amount
        const validOptions = {
            "option1": { description: "Option 1: $70 AUD - 90 minutes", amount: 7000 },
            "option2": { description: "Option 2: $70 AUD - 90 minutes", amount: 7000 },
            "option3": { description: "Option 3: $50 AUD - 60 minutes", amount: 5000 }
        };

        if (!validOptions[coachingOption] || validOptions[coachingOption].amount !== amount) {
            console.error('Invalid coaching option or amount:', { coachingOption, amount });
            return res.status(400).json({ error: 'Invalid coaching option selected.' });
        }

        console.log('Creating Stripe session for:', { email, coachingOption, amount });

        const FRONTEND_URL = process.env.FRONTEND_URL || 'https://prowleradc.github.io';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'aud',
                        product_data: {
                            name: validOptions[coachingOption].description,
                            description: '1-on-1 Coaching Session'
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${FRONTEND_URL}/thank_you`,
            cancel_url: `${FRONTEND_URL}`
        });

        console.log('Stripe session created:', session.id);

        // Send confirmation email
        await sendConfirmationEmail({ email, ign, discord, coachingOption: validOptions[coachingOption].description, amount });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Stripe Checkout Session Error:', error.message);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err.message);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error.'
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
