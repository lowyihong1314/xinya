from app import create_app

app = create_app()

# sudo systemctl restart xinya_flask.service

# sudo journalctl -u xinya_flask.service -f

# sudo tail -f /var/log/nginx/access.log

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5015, debug=True)