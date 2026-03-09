const today = new Date().toISOString().slice(0,10);

fetch(`/data/${today}.json`)
  .then(res => res.json())
  .then(data => {

    document.getElementById("question").textContent = data.question;

    const choicesDiv = document.getElementById("options");

    data.options.forEach((choice, index) => {

      const button = document.createElement("button");
      button.textContent = choice;

      button.onclick = () => {
        if(choice === data.answer){
          document.getElementById("result").textContent = "Correct!";
          button.style.backgroundColor = "green";
          button.style.color = "white";
        } else {
          document.getElementById("result").textContent = "Wrong!";
          button.style.backgroundColor = "red";
          button.style.color = "white";
        }

        document.querySelectorAll('#options button').forEach(btn => {
          btn.disabled = true;
          btn.style.cursor = 'not-allowed';
        });
      };

      choicesDiv.appendChild(button);

    });

  })
  .catch(error => {
    document.getElementById("question").textContent = "Oops, Grizz forgot to add today's question!";
    document.getElementById("result").textContent = "Please berate him on discord to fix this issue!";
  });

