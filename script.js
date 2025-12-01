document.addEventListener('DOMContentLoaded', function() {
    // Select all main navigation links in the sidebar
    const navLinks = document.querySelectorAll('.sidebar nav a');
    // Select all main content sections
    const pageContents = document.querySelectorAll('.page-content');
    // Select the Profile form
    const profileForm = document.querySelector('#profile .profile-form'); 
    
    // --- Dashboard Elements to Update ---
    const userNameElement = document.getElementById('user-name');
    const userAvatarElement = document.getElementById('user-avatar');
    // --- Profile Page Elements to Update ---
    const profileNameInput = document.getElementById('name');
    const profileAvatarElement = document.getElementById('profile-avatar');
    const profileEmailInput = document.getElementById('email');

    // Default Fallback Data
    const defaultName = "Client Investor";
    const defaultInitials = "CI";
    const defaultEmail = "client@telsaai.com";

    // --- Helper Function to calculate initials ---
    function getInitials(fullName) {
        const parts = fullName.split(/\s+/).filter(Boolean); // Split by any space, filter out empty strings
        if (parts.length > 1) {
            return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
        } else if (parts.length === 1 && parts[0].length > 0) {
            return parts[0].charAt(0).toUpperCase();
        }
        return defaultInitials;
    }

    // --- 1. INITIAL DATA LOAD AND BINDING ---
    const storedName = localStorage.getItem('telsa_userName') || defaultName;
    const storedEmail = localStorage.getItem('registeredEmail') || defaultEmail;
    const storedInitials = localStorage.getItem('telsa_userInitials') || getInitials(storedName);
    
    // Apply initial data to all elements
    if (userNameElement) userNameElement.textContent = storedName;
    if (userAvatarElement) userAvatarElement.textContent = storedInitials;
    if (profileNameInput) profileNameInput.value = storedName;
    if (profileAvatarElement) profileAvatarElement.textContent = storedInitials;
    if (profileEmailInput) profileEmailInput.value = storedEmail;

    // --- 2. PAGE SWITCHING LOGIC ---
    function showPage(pageId) {
        pageContents.forEach(section => {
            section.classList.add('hidden');
        });
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.remove('hidden');
        }
    }

    function setActiveLink(clickedLink) {
        navLinks.forEach(link => {
            link.classList.remove('active');
        });
        clickedLink.classList.add('active');
    }

    // Set initial page state on load
    const initialLink = document.querySelector('.sidebar nav a.active');
    if (initialLink) {
        showPage(initialLink.getAttribute('data-page'));
    }

    // Attach click listener to main sidebar links
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            if (this.hasAttribute('data-page')) {
                e.preventDefault(); 
                const pageId = this.getAttribute('data-page');
                setActiveLink(this);
                showPage(pageId);
                // Close sidebar on mobile after clicking a link
                document.getElementById('sidebar').classList.remove('active');
            }
        });
    });

    // --- 3. MOBILE MENU TOGGLE LOGIC ---
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }


    // --- 4. PROFILE FORM SUBMISSION HANDLER ---
    if (profileForm) {
        profileForm.addEventListener('submit', function(e) {
            e.preventDefault(); 
            
            const newName = profileNameInput.value.trim();
            const newEmail = profileEmailInput.value.trim();
            
            if (!newName || !newEmail) {
                alert("Name and Email fields cannot be empty.");
                return;
            }

            const newInitials = getInitials(newName);
            
            // 1. SAVE the new data to Local Storage (Makes it persistent)
            localStorage.setItem('telsa_userName', newName); 
            localStorage.setItem('registeredEmail', newEmail); 
            localStorage.setItem('telsa_userInitials', newInitials);
            
            // 2. Apply the changes immediately to the entire dashboard (Top bar and Profile)
            if (userNameElement) userNameElement.textContent = newName;
            if (userAvatarElement) userAvatarElement.textContent = newInitials;
            if (profileAvatarElement) profileAvatarElement.textContent = newInitials;

            alert("Profile changes saved successfully!");
        });
    }
});