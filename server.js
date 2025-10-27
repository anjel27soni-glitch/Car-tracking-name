let map, marker, watchId, points = 0, timerInterval, callActive = false, speedLimit = 50, lastPosition = null, lastTime = null, geocoder;
let isLoggedIn = false;

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

// Check if on phone and simulate connection (no background apps via full-screen)
function checkPhoneConnection() {
    if (!/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        alert('This app is designed for mobile phones. Please access via your phone\'s browser.');
        return false;
    }
    return true;
}

// Login logic
document.getElementById('login-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('license-photo');
    const errorDiv = document.getElementById('login-error');
    
    if (!fileInput.files[0]) {
        errorDiv.style.display = 'block';
        return;
    }
    
    errorDiv.style.display = 'none';
    const reader = new FileReader();
    reader.onload = () => {
        localStorage.setItem('licensePhoto', reader.result); // Store photo as base64
        isLoggedIn = true;
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        initMap();
        loadScores();
    };
    reader.readAsDataURL(fileInput.files[0]);
});

// Initialize map
function initMap() {
    if (!checkPhoneConnection()) return;
    showLoading(true);
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 28.6139, lng: 77.2090 },
        zoom: 15,
    });
    geocoder = new google.maps.Geocoder();
    marker = new google.maps.Marker({ position: map.getCenter(), map: map });
    showLoading(false);
}

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => console.log('SW registered'));
}

// Start driving mode (enforces full-screen to simulate no background apps)
document.getElementById('start-driving').addEventListener('click', () => {
    if (!isLoggedIn) return;
    try {
        document.documentElement.requestFullscreen();
        alert('Driving mode activated. Full-screen ensures no background apps on phone.');
        startGeolocation();
    } catch (error) {
        alert('Fullscreen failed: ' + error.message);
    }
});

// Page Visibility API for call detection (simulates incoming call if app loses focus)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !callActive) {
        // Assume a call caused focus loss
        startCallTimer();
        navigator.serviceWorker.controller?.postMessage({ type: 'notify', message: 'Incoming call detected! Timer started.' });
    }
});

// Start geolocation
function startGeolocation() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(updatePosition, error => {
            console.error('Geolocation error:', error);
            alert('Location access denied or unavailable.');
        }, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        });
    }
}

// Update position and speed
function updatePosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const currentTime = Date.now();
    let speed = 0;

    if (lastPosition && lastTime) {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(lastPosition.lat, lastPosition.lng),
            new google.maps.LatLng(lat, lng)
        );
        const timeDiff = (currentTime - lastTime) / 1000;
        speed = (distance / 1000) / (timeDiff / 3600);
    }

    lastPosition = { lat, lng };
    lastTime = currentTime;

    marker.setPosition({ lat, lng });
    map.setCenter({ lat, lng });
    document.getElementById('speed-display').textContent = `Current Speed: ${speed.toFixed(1)} km/h`;

    // Reverse geocoding for speed limit
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
            const address = results[0].formatted_address.toLowerCase();
            let roadType = 'city';
            if (address.includes('highway') || address.includes('nh')) roadType = 'highway';
            else if (address.includes('rural') || address.includes('village')) roadType = 'rural';

            axios.get(`/api/speed-limit/${roadType}`).then(res => {
                speedLimit = res.data.speedLimit;
                document.getElementById('speed-limit').textContent = `Speed Limit: ${speedLimit} km/h`;
            }).catch(err => console.error('Speed limit fetch error:', err));
        }
    });

    // Scoring during call
    if (callActive) {
        if (speed > speedLimit) {
            points -= 10;
            navigator.serviceWorker.controller?.postMessage({ type: 'notify', message: 'Overspeeding! Slow down.' });
        } else {
            points += 50 / 60;
        }
        document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
    }
}

// Start call timer
function startCallTimer() {
    if (!callActive) {
        callActive = true;
        let seconds = 0;
        timerInterval = setInterval(() => {
            seconds++;
            document.getElementById('timer').textContent = `Call Timer: ${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
        }, 1000);
        alert('Call detected! Timer started.');
    }
}

// Simulate call
document.getElementById('simulate-call').addEventListener('click', startCallTimer);

// Simulate overtake
document.getElementById('simulate-overtake').addEventListener('click', () => {
    if (callActive) {
        const success = Math.random() > 0.5;
        if (success) {
            points += 100;
            alert('Safe overtake! +100 points.');
        } else {
            points -= 50;
            alert('Unsafe overtake! -50 points.');
        }
        document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
    }
});

// Save score
window.addEventListener('beforeunload', saveScore);
function saveScore() {
    axios.post('/api/save-score', { points, session: new Date().toISOString() }).catch(err => console.error('Save error:', err));
}

// Load scores
function loadScores() {
    axios.get('/api/scores').then(res => {
        const scoreList = document.getElementById('score-list');
        const leaderboard = document.getElementById('leaderboard');
        res.data.sessions.forEach(session => {
            scoreList.innerHTML += `<p>Session: ${session} - Points: ${res.data.totalPoints}</p>`;
        });
        const topSessions = res.data.sessions.slice(-5).reverse();
        leaderboard.innerHTML = 'Leaderboard: ' + topSessions.map(s => s.split('T')[0]).join(', ');
    }).catch(err => console.error('Load scores error:', err));
}

// Check login on load
window.onload = () => {
    if (localStorage.getItem('licensePhoto')) {
        isLoggedIn = true;
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        initMap();
        loadScores();
    }
};