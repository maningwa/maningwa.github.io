document.addEventListener('DOMContentLoaded', () => {
    // Navbar Scroll Effect
    const navbar = document.querySelector('.navbar');

    const handleScroll = () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    };

    window.addEventListener('scroll', handleScroll);
    // transform-fast is 0.2s, so throttle is not strictly necessary for this simple effect, 
    // but good practice. For now, direct binding is fine for this scale.

    // Mobile Menu Toggle
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link, .nav-cta');
    const hamburgerIcon = hamburger.querySelector('i'); // Assuming FontAwesome <i> tag

    hamburger.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('active');

        // Toggle icon between bars and times
        if (isOpen) {
            hamburgerIcon.classList.remove('fa-bars');
            hamburgerIcon.classList.add('fa-times');
        } else {
            hamburgerIcon.classList.remove('fa-times');
            hamburgerIcon.classList.add('fa-bars');
        }
    });

    // Close menu when link is clicked
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            hamburgerIcon.classList.remove('fa-times');
            hamburgerIcon.classList.add('fa-bars');
        });
    });

    // Contact Form Submission
    const contactForm = document.querySelector('.contact-form');
    // TODO: PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE
    const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw0tuqkjtu4yYar-p3n0BS7KJSetAYJWHthUVqfx7cdSkvHxq20sScz-qRUqc-Zg4ejWA/exec";

    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (GOOGLE_SCRIPT_URL === "YOUR_GOOGLE_SCRIPT_URL_HERE") {
                alert("Please configure the Google Script URL in script.js to enable form submission.");
                return;
            }

            const submitBtn = contactForm.querySelector('.submit-btn');
            const originalBtnText = submitBtn.innerText;

            // Disable button and show loading state
            submitBtn.disabled = true;
            submitBtn.innerText = "Sending...";

            // Collect form data
            const formData = new FormData(contactForm);
            const data = {};
            formData.forEach((value, key) => { data[key] = value });

            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(data),
                // no-cors mode is required for Google Apps Script Web App simple POSTs not using ContentService correctly 
                // OR to avoid CORS preflight issues. 
                // However, standard fetch with CORS enabled GScript works best with specific setup.
                // The provided script uses ContentService.MimeType.JSON which usually handles CORS better.
                // But often 'no-cors' is safest 'fire and forget' if you don't need the response content.
                // Let's try standard CORS first; if it fails, the user might need 'no-cors'.
                // Ideally, pure JSON requires plain text/application/json.
                mode: "no-cors",
                headers: {
                    "Content-Type": "application/json"
                }
            })
                .then(() => {
                    // With no-cors, we can't see the response status, so we assume success if no network error.
                    alert("Thank you! Your message has been sent successfully. I will get back to you shortly.");
                    contactForm.reset();
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert("Oops! Something went wrong. Please try again later or contact me via email.");
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerText = originalBtnText;
                });
        });
    }

    // Smooth Scrolling for Anchor Links (already in CSS html { scroll-behavior: smooth })
    // But for older browsers or more control:
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                // Account for fixed header height
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: "smooth"
                });
            }
        });
    });
});
