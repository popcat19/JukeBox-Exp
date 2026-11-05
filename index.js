const plants = [
    "🍂", "🌿", "🌺", "🍃", "🍄", "🍀🌷", "🌈🍂🍁🍀🌷🍄🐲🌈🍃🌺🍄", " 1️⃣3️⃣1️⃣2️⃣",
    "≽(◕ ᴗ ◕)≼", "≽(ᴗ _ ᴗ)≼", "≽(⌐ _ ⌐)≼", "≽(ᵕ ‿ ᵕ)≼",
    "☀️⭐🕒👁️",
    "🪱",
    "not :wackybox:",
    "🐟",
    "⚡","🔵","💫",
    "🍋",
    "✨","🌈","🌧️","🪨","🐍","🌲","🌳","𓆏","🦀","🍄‍🟫","🌵","and Bobby","🥚",
    "1.0.0",
    "(did someone say presets?)",
    "Since 1889", "Since 7/30/2010", "No Escape", "and C A G F motif",
    "[insert funny joke]", "at least 3 presets", "neoff orange", "WOWZERS", "46% serious"
];

const date = new Date();

if (Math.floor(Math.random() * 0) == 0) {
    document.getElementById("goldboxPlant").innerHTML = "  " + plants[(Math.floor(Math.random() * plants.length))];

    const winterPlants = ["🎄", "🍪", "☃️", "🎁", "❄️"];
    if ((date.getDate() >= 22 && date.getDate() <= 26) && date.getMonth() == 11) {
        document.getElementById("goldboxPlant").innerHTML = "  " + winterPlants[(Math.floor(Math.random() * winterPlants.length))];
    }

    const spookyPlants = ["🎃", "🍬", "👻", "🐍", "🧪"];
    if ((date.getDate() == 31) && date.getMonth() == 9) {
        document.getElementById("goldboxPlant").innerHTML = "  " + spookyPlants[(Math.floor(Math.random() * spookyPlants.length))];
    }

    const heartPlants = ["❤️", "🧡", "💛", "💚", "💙", "💜"];
    if ((date.getDate() >= 13 && date.getDate() <= 15) && date.getMonth() == 1) {
        document.getElementById("goldboxPlant").innerHTML = "  " + heartPlants[(Math.floor(Math.random() * heartPlants.length))];
    }

    if ((date.getDate() == 14) && date.getMonth() == 2) {
        const piePlants = ["π", "🥧", "🍏", "🍋", "3.14"];
        document.getElementById("goldboxPlant").innerHTML = "  " + piePlants[(Math.floor(Math.random() * piePlants.length))];
    }
}

if ((date.getDate() == 1) && date.getMonth() == 3) {
    const foolishPlants = ["Censorship Update", "19.8.4", "👁️", "🐍", "🚫"];
    document.getElementById("goldboxPlant").innerHTML = "  " + foolishPlants[(Math.floor(Math.random() * foolishPlants.length))];
}

if ((date.getDate() == 21) && date.getMonth() == 6) {
    const years = date.getFullYear() - 2025;
    const birthdayPlants = [years + " year" + (years != 1 ? "s" : "") + "!", "🎂", "🎉", "Happy Birthday!", "Anniversary"];
    document.getElementById("goldboxPlant").innerHTML = "  " + birthdayPlants[(Math.floor(Math.random() * birthdayPlants.length))];
}

if(Math.random() * 10000 < 1) {
    document.getElementById("goldboxPlant").addEventListener("click", function (event) {
        window.open("./macandcheese.html", "_blank");
    })
    document.getElementById("goldboxPlant").innerHTML = " macaroni and cheese";
    document.getElementById("goldboxPlant").style.color = "#bb8822";
}

if(document.getElementById("goldboxPlant").innerText.includes("🐲")) {
    document.getElementById("goldboxPlant").addEventListener("mouseover", function (event) {
        document.getElementById("goldboxPlant").innerText = " 🌈🍂🍁🍀🌷🍄🐍🌈🍃🌺🍄";
    }, { once: true })
}

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|android|ipad|playbook|silk/i.test(navigator.userAgent)) {
    document.getElementById("introduction").innerHTML = "JukeBox-Exp is an online tool for sketching and sharing chiptune melodies. Make sure that your volume is turned up, then press the play button!";
}

function browserHasRequiredFeatures() {
    "use strict";
    if (window.AudioContext == undefined && window.webkitAudioContext == undefined) {
        return false;
    }

    try {
        eval("class T {}");
        eval("const a = () => 0");
        eval("for (const a of []);");
    } catch (error) {
        return false;
    }

    return true;
}

if (browserHasRequiredFeatures()) {
    var fileref = document.createElement("script");
    fileref.setAttribute("type", "text/javascript");
    if ((date.getDate() == 1) && date.getMonth() == 3) {
        fileref.setAttribute("src", "foolish_editor.min.js");
    } else {
        fileref.setAttribute("src", "beepbox_editor.min.js");
    }
    document.head.appendChild(fileref);
} else {
    document.getElementById("beepboxEditorContainer").innerHTML = "Sorry, JukeBox-Exp doesn't support your browser. Try a recent version of Chrome, Firefox, Edge, Safari, or Opera.";
}

if (/^#[1-6]/.test(location.hash)) {
    document.getElementById("linkTo2_3").href += location.hash;
}
if (/^#[1-8]/.test(location.hash)) {
    document.getElementById("linkTo3_0").href += location.hash;
}
