# Project Name

This project is containerized using **Docker** for easy setup and deployment.

---

## 🐳 Prerequisites

- [Docker Desktop](https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe?utm_source=docker&utm_medium=webreferral&utm_campaign=dd-smartbutton&utm_location=module&_gl=1*1u13tvd*_gcl_au*NzE1OTMyMTkzLjE3NTY3MjE3MTM.*_ga*ODU2Mjk2MDY3LjE3NTY3MjE3MTM.*_ga_XJWPQMJYHQ*czE3NTY3MjE3MTMkbzEkZzEkdDE3NTY3MjE3MTQkajU5JGwwJGgw) installed and run

---

## 🚀 Running the Application

### 1. Clone the repository
```bash
git clone https://github.com/adnanjabait/receipt-assessment-backend.git
cd receipt-assessment-backend
```

### 2. Run the docker desktop

### 3. Configure DB in environment (AWS RDS configured by default)

### 4. Build the docker images
```bash
docker compose build
```
### 5. Run the docker composer
```bash
docker compose up
```

### 6. Check the docker images
```bash
docker ps
```

### 7. Stop docker
```bash
docker compose down (stop all containers)
Or
docker stop <container-id>
```
