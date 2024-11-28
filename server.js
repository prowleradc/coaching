require('dotenv').config(); // Load environment variables
const express = require('express');
const stripe = require('stripe')(
    process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_LIVE_SECRET_KEY
        : process.env.STRIPE_TEST_SECRET_KEY
);
const cors = require('cors');
const nodemailer = require('nodemailer');

const bodyParser = require('body-parser')

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

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
const allowedOrigins = ['https://prowleradc.github.io', 'http://localhost:3000', 'null']; // Replace with your frontend URL
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

// Stripe requires raw body for webhook signature verification
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook') {
        next();
    } else {
        bodyParser.json()(req, res, next)
    }
});

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587, // Standard SMTP port
    secure: false, // Use TLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Function to send confirmation email
const sendConfirmationEmail = async (data) => {
    const { email, ign, discord, coachingOption, amount } = data;

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email, // Send to customer email or admin email
        subject: 'Coaching Session Confirmation',
        html: `
            <h1>Coaching Session Confirmation</h1>
            <p>Thank you for booking a session with me!</p>
            <h3>Details:</h3>
            <ul>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>IGN:</strong> ${ign}</li>
                <li><strong>Discord:</strong> ${discord}</li>
                <li><strong>Coaching Option:</strong> ${coachingOption}</li>
                <li><strong>Amount Paid:</strong> $${(amount / 100).toFixed(2)} AUD</li>
            </ul>
            <p>Looking forward to the session!</p>
        `
    };

    console.log(`Attempting to send confirmation email to: ${email}`); // Log the email recipient

    try {
        await transporter.sendMail(mailOptions);
        console.log('Confirmation email sent to:', email);
    } catch (error) {
        console.error('Error sending email:', error.message);
        throw error;
    }
};

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the Coaching Application API!');
});

// Create Checkout Session route
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { email, ign, discord, coachingOption, amount } = req.body;

        req.headers['access-control-allow-origin'] = "*";

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

        const validOptions = {
            "option1": { description: "90 minutes", amount: 7000 },
            "option2": { description: "90 minutes", amount: 7000 },
            "option3": { description: "60 minutes", amount: 5000 }
        };

        if (!validOptions[coachingOption] || validOptions[coachingOption].amount !== amount) {
            console.error('Invalid coaching option or amount:', { coachingOption, amount });
            return res.status(400).json({ error: 'Invalid coaching option selected.' });
        }

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
            success_url: `${process.env.FRONTEND_URL}thank_you`,
            cancel_url: `${process.env.FRONTEND_URL}`,
            metadata: { email, ign, discord, coachingOption, amount }
        });

        console.log('Checkout session created:', session.id); // Log the session ID
        res.json({ url: session.url });
    } catch (error) {
        console.error('Stripe Checkout Session Error:', error.message);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
});

// Webhook endpoint for Stripe events
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
        const sig = req.headers['stripe-signature'];
        console.log(sig);
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log('Webhook received...'); // Initial log
        console.log('Event received and verified:', event.type); // Log verified event type
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log('Checkout session completed:', session);

        try {
            // Log metadata before sending emails
            console.log('Session metadata:', session.metadata);

            // Send confirmation email to user
            await sendConfirmationEmail({
                email: session.metadata.email,
                ign: session.metadata.ign,
                discord: session.metadata.discord,
                coachingOption: session.metadata.coachingOption,
                amount: session.amount_total
            });
            console.log('User confirmation email sent successfully.');

            // Send confirmation email to admin
            await sendConfirmationEmail({
                email: 'prowleradc@gmail.com',
                ign: session.metadata.ign,
                discord: session.metadata.discord,
                coachingOption: session.metadata.coachingOption,
                amount: session.amount_total
            });
            console.log('Admin confirmation email sent successfully.');
        } catch (error) {
            console.error('Error processing confirmation emails:', error.message);
        }
    }

    res.status(200).send('Webhook received successfully.');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(process.env.NODE_ENV);
});
