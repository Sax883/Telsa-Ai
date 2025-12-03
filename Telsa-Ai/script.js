document.addEventListener('DOMContentLoaded', function() {
    // Select all main navigation links in the sidebar
    const navLinks = document.querySelectorAll('.sidebar nav a');
    // Select all main content sections
    const pageContents = document.querySelectorAll('.page-content');
    // Select the Profile form
    const profileForm = document.querySelector('#profile .profile-form'); 

    // --- Dynamic User Details Update (New Logic) ---
    const userNameElement = document.getElementById('user-name');
    const userAvatarElement = document.getElementById('user-avatar');
    const profileNameInput = document.getElementById('name');
    const profileAvatarElement = document.getElementById('profile-avatar');
    const profileEmailInput = document.getElementById('email');

    // Retrieve stored user data
    const storedName = localStorage.getItem('telsa_userName');
    const storedInitials = localStorage.getItem('telsa_userInitials');
    const registeredEmail = localStorage.getItem('registeredEmail');
    
    // Apply user data if available, otherwise use a generic placeholder
    if (storedName && userAvatarElement) {
        // Update top-bar user name and avatar
        if (userNameElement) userNameElement.textContent = storedName;
        if (userAvatarElement) userAvatarElement.textContent = storedInitials;

        // Update profile section
        if (profileNameInput) profileNameInput.value = storedName;
        if (profileAvatarElement) profileAvatarElement.textContent = storedInitials;
        // Update profile email if registered email is stored
        if (profileEmailInput && registeredEmail) profileEmailInput.value = registeredEmail;
    }


    function showPage(pageId) {
        // 1. Hide all pages
        pageContents.forEach(section => {
            section.classList.add('hidden');
        });

        // 2. Show the requested page
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('active');
        }
    }

    function setActiveLink(clickedLink) {
        // 1. Remove 'active' class from all links
        navLinks.forEach(link => {
            link.classList.remove('active');
        });

        // 2. Add 'active' class to the clicked link
        clickedLink.classList.add('active');
    }

    // Attach click listener to main sidebar links (Wallet, History, Profile etc.)
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Check if the link has a data-page attribute (internal link for content swapping)
            if (this.hasAttribute('data-page')) {
                // *** THIS IS THE CRITICAL LINE ***
                e.preventDefault(); // Stop the link from jumping to the top of the page
                
                const pageId = this.getAttribute('data-page');

                setActiveLink(this);
                showPage(pageId);
            }
            // If it doesn't have data-page, it's an external link (like Logout), let it navigate normally
        });
    });

    // Handle Profile Form Submission: Save Changes & Redirect
    if (profileForm) {
        profileForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Stop the form from submitting normally
            
            // SIMULATED: Update name in local storage if changed in profile
            const newName = document.getElementById('name').value;
            const newInitials = newName.match(/\b(\w)/g).join('').toUpperCase().substring(0, 2);
            localStorage.setItem('telsa_userName', newName);
            localStorage.setItem('telsa_userInitials', newInitials);

            // SIMULATED SAVE ACTION
            alert('Profile Changes Saved Successfully! Redirecting...');
            
            // Redirect back to the dashboard's home page (which will reload the name/avatar)
            window.location.href = 'dashboard.html'; 
        });
    }

    // Initial load: ensure the 'home' page is active
    const initialPageId = document.querySelector('.sidebar nav a.active') ? document.querySelector('.sidebar nav a.active').getAttribute('data-page') : 'home';
    showPage(initialPageId);
});