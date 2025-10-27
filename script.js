let map, marker, watchId, points = 5000, timerInterval, callActive = false, speedLimit = 50, lastPosition = null, lastTime = null, geocoder;
let isLoggedIn = false, isDownloading = false, isConnected = false, deductionLog = [];

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function checkPhoneConnection() {
    if (!/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        alert('This app must be opened on your phone or connected via WiFi/Bluetooth. Incoming calls on your phone will start the timer.');
        return false;
    }
    return true;
}

function checkUploads() {
    const license = document.getElementById('license-photo').files[0];
    const aadhar = document.getElementById('aadhar-photo').files[0];
    const btn = document.getElementById('login-btn');
    btn.disabled = !(license && aadhar);
    if (!btn.disabled) {
        document.getElementById('connect-btn').style.display = 'inline-block';
    }
}

document.getElementById('login-btn').addEventListener('click', () => {
    const licenseInput = document.getElementById('license-photo');
    const aadharInput = document.getElementById('aadhar-photo');
    const errorDiv = document.getElementById('login-error');
    
    if (!licenseInput.files[0] || !aadharInput.files[0]) {
        errorDiv.style.display = 'block';
        return;
    }
    
    errorDiv.style.display = 'none';
    
    const licenseReader = new FileReader();
    const aadharReader = new FileReader();
    
    licenseReader.onload = () => {
        localStorage.setItem('licensePhoto', licenseReader.result);
        aadharReader.readAsDataURL(aadharInput.files[0]);
    };
    
    aadharReader.onload = () => {
        localStorage.setItem('aadharPhoto', aadharReader.result);
        document.getElementById('connect-btn').style.display = 'inline-block';
    };
    
    licenseReader.readAsDataURL(licenseInput.files[0]);
});

document.getElementById('connect-btn').addEventListener('click', () => {
    isConnected = true;
    alert('Connected to phone! Incoming calls will now start the timer.');
    document.getElementById('connect-btn').style.display = 'none';
    proceedToApp();
});

function proceedToApp() {
    if (!isConnected) {
        alert('Please connect to your phone first.');
        return;
    }
    isLoggedIn = true;
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initMap();
    startDrivingMode();
    loadScores();
    loadDeductionLog();
    loadSafeActivities();
}

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

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => console.log('SW registered'));
}

function startDrivingMode() {
    try {
        document.documentElement.requestFullscreen();
        startGeolocation();
    } catch (error) {
        alert('Fullscreen failed: ' + error.message);
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden && isConnected && !callActive) {
        startCallTimer();
        navigator.serviceWorker.controller?.postMessage({ type: 'notify', message: 'Incoming call detected on connected phone! Timer started.' });
    } else if (document.hidden) {
        alert('Other apps cannot be opened; only this call app is allowed. Downloads will be interrupted.');
        if (isDownloading) {
            alert('Download interrupted.');
            isDownloading = false;
        }
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        }
    }
});

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

    // Safe driving reward: +50 per minute (~0.83 per second) when speed <= limit and no call active
    if (speed > 0 && speed <= speedLimit && !callActive) {
        points += 50 / 60; // Approximate per second
        deductionLog.push({ type: 'Safe Driving Reward', timestamp: Date.now(), pointsDeducted: -(50 / 60) }); // Log as positive (negative deduction)
        saveDeductionLog();
        displayDeductionLog();
        document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
    }

    // Overspeeding deduction
    if (speed > speedLimit) {
        points -= 10;
        deductionLog.push({ type: 'Overspeeding Deduction', timestamp: Date.now(), pointsDeducted: 10 });
        saveDeductionLog();
        displayDeductionLog();
        navigator.serviceWorker.controller?.postMessage({ type: 'notify', message: 'Overspeeding! Slow down.' });
        document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
    }

    if (callActive) {
        if (speed < 1) {
            clearInterval(timerInterval);
            callActive = false;
            document.getElementById('end-call').style.display = 'none';
            alert('Call ended: Car stopped.');
            document.getElementById('timer').textContent = 'Call Timer: 00:00';
        }
    }
}

function startCallTimer() {
    if (!callActive) {
        callActive = true;
        document.getElementById('end-call').style.display = 'inline-block';
        let seconds = 0;
        timerInterval = setInterval(() => {
            seconds++;
            points -= 10;
            deductionLog.push({ type: 'Incoming Call Deduction', timestamp: Date.now(), pointsDeducted: 10 });
            saveDeductionLog();
            displayDeductionLog();
            document.getElementById('timer').textContent = `Call Timer: ${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
            document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
        }, 1000);
        alert('Incoming call received! Timer started.');
    }
}

document.getElementById('simulate-call').addEventListener('click', startCallTimer);

document.getElementById('end-call').addEventListener('click', () => {
    if (callActive) {
        clearInterval(timerInterval);
        callActive = false;
        document.getElementById('end-call').style.display = 'none';
        alert('Call ended manually.');
        document.getElementById('timer').textContent = 'Call Timer: 00:00';
    }
});

document.getElementById('simulate-overtake').addEventListener('click', () => {
    if (callActive) {
        points += 100;
        axios.post('/api/save-safe-activity', { points: 100, activity: 'Safe Overtake' });
        deductionLog.push({ type: 'Safe Overtake Reward', timestamp: Date.now(), pointsDeducted: -100 });
        saveDeductionLog();
        displayDeductionLog();
        alert('Safe overtake! +100 points.');
        document.getElementById('points').textContent = `Points: ${points.toFixed(0)}`;
    }
});

function saveDeductionLog() {
    localStorage.setItem('deductionLog', JSON.stringify(deductionLog));
}

function displayDeductionLog() {
    const logList = document.getElementById('log-list');
    logList.innerHTML = '';
    deductionLog.slice(-10).forEach(event => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        logList.innerHTML += `<p>${time}: ${event.type} - ${event.pointsDeducted > 0 ? '-' : '+'}${Math.abs(event.pointsDeducted).toFixed(0)} points</p>`;
    });
}

function loadDeductionLog() {
    const savedLog = localStorage.getItem('deductionLog');
    if (savedLog) {
        deductionLog = JSON.parse(savedLog);
        displayDeductionLog();
    }
}

function loadScores() {
    axios.get('/api/scores').then(res => {
        const scoreList = document.getElementById('score-list');
        res.data.sessions.forEach(session => {
            scoreList.innerHTML += `<p>Session: ${session} - Points: ${res.data.totalPoints}</p>`;
        });
    }).catch(err => console.error('Load scores error:', err));
}

function loadSafeActivities() {
    axios.get('/api/safe-activities').then(res => {
        const leaderboard = document.getElementById('leaderboard');
        leaderboard.innerHTML = 'Leaderboard: Latest 5 Safe Activities<br>';
        res.data.forEach(activity => {
            leaderboard.innerHTML += `<p>${activity.activity}: +${activity.points} points</p>`;
        });
    }).catch(err => console.error('Load safe activities error:', err));
}

window.addEventListener('beforeunload', () => {
    axios.post('/api/save-score', { points, session: new Date().toISOString() });
});

window.onload = () => {
    const license = localStorage.getItem('licensePhoto');
    const aadhar = localStorage.getItem('aadharPhoto');
    if (license && aadhar) {
        document.getElementById('upload-section').style.display = 'none';
        document.getElementById('saved-message').style.display = 'block';
        document.getElementById('login-btn').disabled = false;
        document.getElementById('connect-btn').style.display = 'inline-block';
    } else {
        document.getElementById('license-photo').addEventListener('change', checkUploads);
        document.getElementById('aadhar-photo').addEventListener('change', checkUploads);
    }
};