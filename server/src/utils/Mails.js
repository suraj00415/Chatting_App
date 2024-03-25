import { createTransporter } from "./MailTransporter.js";

export const sendVerificationMail = (user, unHashedToken) => {
    const transporter = createTransporter();

    let message = {
        from: '"Chatt App" <tubeverse@outlook.com>',
        to: user?.email,
        subject: "User Verification Mail",
        html: `<p>Hello ${user?.name}, verify your email by clicking on this link...</p>
        <a href='${process.env.CLIENT_URL}/verify-email?emailVerifyToken=${unHashedToken}'> Verify Your Email</a>`,
    };

    transporter.sendMail(message, (err, inf) => {
        if (err) {
            console.log(err);
        } else {
            console.log("Verification Email Sent");
        }
    });
};