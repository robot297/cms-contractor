const { createApp } = Vue;

const app = createApp({
  template: `
    <div class="container">
      <header>
        <h1>📋 Contractor CMS</h1>
        <nav>
          <button @click="currentView = 'dashboard'" :class="{active: currentView === 'dashboard'}">Dashboard</button>
          <button @click="currentView = 'clients'" :class="{active: currentView === 'clients'}">Clients</button>
          <button @click="currentView = 'projects'" :class="{active: currentView === 'projects'}">Projects</button>
        </nav>
      </header>

      <main>
        <!-- Dashboard View -->
        <section v-if="currentView === 'dashboard'" class="view">
          <h2>Dashboard</h2>
          <div class="stats">
            <div class="stat-card">
              <h3>Total Clients</h3>
              <p class="stat-value">{{ clients.length }}</p>
            </div>
            <div class="stat-card">
              <h3>Active Projects</h3>
              <p class="stat-value">{{ projects.filter(p => p.status === 'In Progress').length }}</p>
            </div>
            <div class="stat-card">
              <h3>Completed Projects</h3>
              <p class="stat-value">{{ projects.filter(p => p.status === 'Completed').length }}</p>
            </div>
          </div>

          <div class="recent-section">
            <h3>Recent Projects</h3>
            <div v-if="projects.length === 0" class="empty-state">No projects yet</div>
            <div v-else class="project-list">
              <div v-for="project in projects.slice(0, 5)" :key="project.id" class="project-item">
                <div class="project-header">
                  <h4>{{ project.title }}</h4>
                  <span :class="['status', project.status.toLowerCase().replace(' ', '-')]">{{ project.status }}</span>
                </div>
                <p class="client-name">{{ project.client_name }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Clients View -->
        <section v-if="currentView === 'clients'" class="view">
          <div class="section-header">
            <h2>Clients</h2>
            <button @click="showAddClient = true" class="btn-primary">+ Add Client</button>
          </div>

          <div v-if="showAddClient" class="modal-overlay" @click="showAddClient = false">
            <div class="modal" @click.stop>
              <h3>Add New Client</h3>
              <form @submit.prevent="addClient">
                <input v-model="newClient.name" placeholder="Name" required>
                <input v-model="newClient.email" placeholder="Email" type="email">
                <input v-model="newClient.phone" placeholder="Phone">
                <input v-model="newClient.company" placeholder="Company">
                <input v-model="newClient.hourly_rate" placeholder="Hourly Rate" type="number" step="0.01">
                <textarea v-model="newClient.notes" placeholder="Notes"></textarea>
                <div class="form-actions">
                  <button type="submit" class="btn-primary">Save</button>
                  <button type="button" class="btn-secondary" @click="showAddClient = false">Cancel</button>
                </div>
              </form>
            </div>
          </div>

          <div v-if="clients.length === 0" class="empty-state">No clients yet. Add one to get started!</div>
          <div v-else class="clients-grid">
            <div v-for="client in clients" :key="client.id" class="client-card">
              <div class="card-header">
                <h3>{{ client.name }}</h3>
                <button @click="deleteClient(client.id)" class="btn-delete">✕</button>
              </div>
              <p v-if="client.company" class="company">{{ client.company }}</p>
              <p v-if="client.email" class="email">📧 {{ client.email }}</p>
              <p v-if="client.phone" class="phone">📱 {{ client.phone }}</p>
              <p v-if="client.hourly_rate" class="rate">💰 ${{ client.hourly_rate }}/hr</p>
              <p v-if="client.notes" class="notes">{{ client.notes }}</p>
              <div class="project-count">{{ getClientProjectCount(client.id) }} project(s)</div>
            </div>
          </div>
        </section>

        <!-- Projects View -->
        <section v-if="currentView === 'projects'" class="view">
          <div class="section-header">
            <h2>Projects</h2>
            <button @click="showAddProject = true" class="btn-primary">+ Add Project</button>
          </div>

          <div v-if="showAddProject" class="modal-overlay" @click="showAddProject = false">
            <div class="modal" @click.stop>
              <h3>Add New Project</h3>
              <form @submit.prevent="addProject">
                <select v-model="newProject.client_id" required>
                  <option value="">Select Client</option>
                  <option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option>
                </select>
                <input v-model="newProject.title" placeholder="Project Title" required>
                <textarea v-model="newProject.description" placeholder="Description"></textarea>
                <select v-model="newProject.status">
                  <option>Not Started</option>
                  <option>In Progress</option>
                  <option>Completed</option>
                </select>
                <input v-model="newProject.start_date" placeholder="Start Date" type="date">
                <input v-model="newProject.end_date" placeholder="End Date" type="date">
                <div class="form-actions">
                  <button type="submit" class="btn-primary">Save</button>
                  <button type="button" class="btn-secondary" @click="showAddProject = false">Cancel</button>
                </div>
              </form>
            </div>
          </div>

          <div v-if="projects.length === 0" class="empty-state">No projects yet. Create one to get started!</div>
          <div v-else class="projects-table">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="project in projects" :key="project.id">
                  <td>{{ project.title }}</td>
                  <td>{{ project.client_name }}</td>
                  <td><span :class="['status', project.status.toLowerCase().replace(' ', '-')]">{{ project.status }}</span></td>
                  <td>{{ project.start_date || '-' }}</td>
                  <td>{{ project.end_date || '-' }}</td>
                  <td>
                    <button @click="deleteProject(project.id)" class="btn-delete">Delete</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  `,
  data() {
    return {
      currentView: 'dashboard',
      clients: [],
      projects: [],
      showAddClient: false,
      showAddProject: false,
      newClient: { name: '', email: '', phone: '', company: '', hourly_rate: '', notes: '' },
      newProject: { client_id: '', title: '', description: '', status: 'Not Started', start_date: '', end_date: '' }
    };
  },
  methods: {
    async fetchClients() {
      try {
        const response = await fetch('/api/clients');
        this.clients = await response.json();
      } catch (error) {
        console.error('Error fetching clients:', error);
      }
    },
    async fetchProjects() {
      try {
        const response = await fetch('/api/projects');
        this.projects = await response.json();
      } catch (error) {
        console.error('Error fetching projects:', error);
      }
    },
    async addClient() {
      try {
        const response = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newClient)
        });
        if (response.ok) {
          this.showAddClient = false;
          this.newClient = { name: '', email: '', phone: '', company: '', hourly_rate: '', notes: '' };
          this.fetchClients();
        }
      } catch (error) {
        console.error('Error adding client:', error);
      }
    },
    async deleteClient(id) {
      if (confirm('Are you sure?')) {
        try {
          await fetch(`/api/clients/${id}`, { method: 'DELETE' });
          this.fetchClients();
          this.fetchProjects();
        } catch (error) {
          console.error('Error deleting client:', error);
        }
      }
    },
    async addProject() {
      try {
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newProject)
        });
        if (response.ok) {
          this.showAddProject = false;
          this.newProject = { client_id: '', title: '', description: '', status: 'Not Started', start_date: '', end_date: '' };
          this.fetchProjects();
        }
      } catch (error) {
        console.error('Error adding project:', error);
      }
    },
    async deleteProject(id) {
      if (confirm('Are you sure?')) {
        try {
          await fetch(`/api/projects/${id}`, { method: 'DELETE' });
          this.fetchProjects();
        } catch (error) {
          console.error('Error deleting project:', error);
        }
      }
    },
    getClientProjectCount(clientId) {
      return this.projects.filter(p => p.client_id === clientId).length;
    }
  },
  mounted() {
    this.fetchClients();
    this.fetchProjects();
  }
});

app.mount('#app');
